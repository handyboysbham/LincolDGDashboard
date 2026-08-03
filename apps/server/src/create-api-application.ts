import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import helmet from "@fastify/helmet";

import { AppModule } from "./app.module.js";
import { registerRequestContext } from "./context/register-request-context.js";
import { RequestContextService } from "./context/request-context.service.js";

export interface ApiApplication {
  application: NestFastifyApplication;
  document: OpenAPIObject;
}

export async function createApiApplication(): Promise<ApiApplication> {
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  application.enableShutdownHooks();
  application.setGlobalPrefix("api/v1", {
    exclude: [
      { method: RequestMethod.GET, path: "health/live" },
      { method: RequestMethod.GET, path: "health/ready" },
    ],
  });
  application.useGlobalPipes(
    new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
  );
  registerRequestContext(
    application.getHttpAdapter().getInstance(),
    application.get(RequestContextService),
  );
  await application.register(helmet);

  const swaggerConfiguration = new DocumentBuilder()
    .setTitle("Lincoln Dirt and Gravel API")
    .setDescription("Lincoln Dirt and Gravel operating system API")
    .setVersion("1.1.0")
    .build();
  const document = SwaggerModule.createDocument(application, swaggerConfiguration);
  SwaggerModule.setup("api/docs", application, document, {
    jsonDocumentUrl: "/api/docs/openapi.json",
  });
  await application.init();

  return { application, document };
}
