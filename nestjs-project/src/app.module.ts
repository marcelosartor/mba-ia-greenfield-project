import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { appConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    appConfigModule,
    DatabaseModule,
    AuthModule,
    CategoriesModule,
    VideosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
