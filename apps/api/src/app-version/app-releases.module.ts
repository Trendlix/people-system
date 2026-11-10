import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppReleasesController } from './app-releases.controller.js';
import { AppReleasesService } from './app-releases.service.js';
import { AppStoreService, OutdatedIphoneGuard } from './app-store.service.js';

// The app's newest build, for its force update: Android's from the repository's releases, the iPhone's from the App
// Store, an iPhone build older than the store's refused (10 November 2026; app-store.ts).
@Module({ controllers: [AppReleasesController], providers: [AppReleasesService, AppStoreService, { provide: APP_GUARD, useClass: OutdatedIphoneGuard }] })
export class AppReleasesModule {}
