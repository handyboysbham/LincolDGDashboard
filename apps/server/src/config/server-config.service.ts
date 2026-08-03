import { Injectable } from "@nestjs/common";

import { loadServerConfig, type ServerConfig } from "./server-config.js";

@Injectable()
export class ServerConfigService {
  public readonly value: ServerConfig;

  public constructor() {
    this.value = loadServerConfig(process.env);
  }
}
