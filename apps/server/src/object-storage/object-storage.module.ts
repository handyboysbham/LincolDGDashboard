import { S3Client } from "@aws-sdk/client-s3";
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";

import { ServerConfigService } from "../config/server-config.service.js";
import { ObjectStorageService } from "./object-storage.service.js";
import { OBJECT_STORAGE_CLIENT } from "./object-storage.tokens.js";

@Injectable()
class ObjectStorageShutdown implements OnApplicationShutdown {
  public constructor(@Inject(OBJECT_STORAGE_CLIENT) private readonly client: S3Client) {}

  public onApplicationShutdown(): void {
    this.client.destroy();
  }
}

@Global()
@Module({
  exports: [ObjectStorageService],
  providers: [
    {
      inject: [ServerConfigService],
      provide: OBJECT_STORAGE_CLIENT,
      useFactory: (configuration: ServerConfigService): S3Client => {
        const storage = configuration.value.objectStorage;
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
    ObjectStorageService,
    ObjectStorageShutdown,
  ],
})
export class ObjectStorageModule {}
