import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { createE2eApp, registerConfirmAndLogin } from './helpers/e2e-app';

interface Body {
  name?: string;
  nickname?: string;
  description?: string | null;
  created_at?: string;
  error?: string;
}

describe('channels-update-me', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tokenA: string;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
    tokenA = await registerConfirmAndLogin(app, 'owner-a@example.com');
    await registerConfirmAndLogin(app, 'other-b@example.com');
  });

  const channelOf = async (email: string) => {
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    return dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: user.id });
  };

  const patch = (body: object, token: string | null = tokenA) => {
    const req = request(app.getHttpServer()).patch('/channels/me').send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. Editar o próprio canal

  it('dono-edita-nickname-nome-e-descricao', async () => {
    const res = await patch({
      nickname: 'novo_nome',
      name: 'Meu Canal',
      description: 'Sobre',
    }).expect(200);

    const body = res.body as Body;
    expect(body).toMatchObject({
      nickname: 'novo_nome',
      name: 'Meu Canal',
      description: 'Sobre',
    });
    expect(typeof body.created_at).toBe('string');
    for (const hidden of ['id', 'user_id', 'email']) {
      expect(body).not.toHaveProperty(hidden);
    }
    expect(await channelOf('owner-a@example.com')).toMatchObject({
      nickname: 'novo_nome',
      name: 'Meu Canal',
      description: 'Sobre',
    });
  });

  it('nickname-reservado', async () => {
    const before = await channelOf('owner-a@example.com');

    const res = await patch({ nickname: 'admin' }).expect(400);

    expect((res.body as Body).error).toBe('NICKNAME_RESERVED');
    expect((await channelOf('owner-a@example.com')).nickname).toBe(
      before.nickname,
    );
  });

  it('nickname-com-formato-invalido', async () => {
    for (const nickname of ['ab', 'Com-Hifen']) {
      const res = await patch({ nickname }).expect(400);
      expect((res.body as Body).error).toBe('VALIDATION_ERROR');
    }
  });

  it('nickname-de-outro-canal', async () => {
    const before = await channelOf('owner-a@example.com');
    const other = await channelOf('other-b@example.com');

    const res = await patch({ nickname: other.nickname, name: 'Outro' }).expect(
      409,
    );

    expect((res.body as Body).error).toBe('NICKNAME_ALREADY_EXISTS');
    const after = await channelOf('owner-a@example.com');
    expect(after.nickname).toBe(before.nickname);
    expect(after.name).toBe(before.name);
  });

  it('corpo-vazio-e-campo-proibido', async () => {
    for (const body of [
      {},
      { user_id: '00000000-0000-0000-0000-000000000000' },
    ]) {
      const res = await patch(body).expect(400);
      expect((res.body as Body).error).toBe('VALIDATION_ERROR');
    }
  });

  it('anonimo', async () => {
    await patch({ name: 'X' }, null).expect(401);
  });
});
