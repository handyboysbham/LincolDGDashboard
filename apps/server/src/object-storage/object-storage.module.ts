import { S3Client } from "@aws-sdk/client-s3";
import { GoogleDriveClient } from "@ldg/google-drive";
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";

import { ServerConfigService } from "../config/server-config.service.js";
import { ObjectStorageService } from "./object-storage.service.js";
import { GOOGLE_DRIVE_CLIENT, OBJECT_STORAGE_CLIENT } from "./object-storage.tokens.js";

@Injectable()
class ObjectStorageShutdown implements OnApplicationShutdown {
  public constructor(
    @Inject(OBJECT_STORAGE_CLIENT) private readonly client: S3Client | undefined,
  ) {}

  public onApplicationShutdown(): void {
    this.client?.destroy();
  }
}

@Global()
@Module({
  exports: [ObjectStorageService],
  providers: [
    {
      inject: [ServerConfigService],
      provide: OBJECT_STORAGE_CLIENT,
      useFactory: (configuration: ServerConfigService): S3Client | undefined => {
        const storage = configuration.value.objectStorage.s3;
        if (!storage) return undefined;
        return new S3Client({
          credentials: {
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
          },
          endpoint: storage.endpoint,
          forcePathStyle: storage.forcePathStyle,
          region: storage.region,
        });
      },
    },
    {
      inject: [ServerConfigService],
      provide: GOOGLE_DRIVE_CLIENT,
      useFactory: (configuration: ServerConfigService): GoogleDriveClient | undefined => {
        const drive = configuration.value.objectStorage.googleDrive;
        if (!drive) return undefined;
        return new GoogleDriveClient({
          apiBaseUrl: drive.apiBaseUrl,
          privateKey: drive.privateKey,
          serviceAccountEmail: drive.serviceAccountEmail,
          tokenUrl: drive.tokenUrl,
        });
      },
    },
    ObjectStorageService,
    ObjectStorageShutdown,
  ],
})
export class ObjectStorageModule {}
