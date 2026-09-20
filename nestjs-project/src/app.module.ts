import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { appConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [appConfigModule, DatabaseModule, AuthModule, VideosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
