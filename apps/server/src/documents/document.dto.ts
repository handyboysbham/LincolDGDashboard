import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export const supportedDocumentMediaTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
] as const;

export class CreateDocumentUploadDto {
  @ApiProperty({ example: "supplier-ticket.pdf", maxLength: 255, type: String })
  @IsString()
  @MaxLength(255)
  public originalFilename!: string;

  @ApiProperty({ enum: supportedDocumentMediaTypes, type: String })
  @IsIn(supportedDocumentMediaTypes)
  public mediaType!: (typeof supportedDocumentMediaTypes)[number];

  @ApiProperty({ maximum: 104857600, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(104_857_600)
  public sizeBytes!: number;

  @ApiProperty({ example: "a".repeat(64), minLength: 64, type: String })
  @Matches(/^[a-f0-9]{64}$/i)
  public sha256!: string;
}

export class CreateDocumentPublicLinkDto {
  @ApiPropertyOptional({ default: 86400, maximum: 604800, minimum: 60, type: Number })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(604_800)
  public expiresInSeconds?: number;

  @ApiProperty({ default: "download", enum: ["download"], type: String })
  @IsIn(["download"])
  public scope!: "download";
}

export class DocumentDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public mediaType!: string;

  @ApiProperty({ type: String })
  public originalFilename!: string;

  @ApiProperty({ type: Number })
  public sizeBytes!: number;

  @ApiProperty({ enum: ["pending", "available", "rejected"], type: String })
  public status!: "available" | "pending" | "rejected";
}

export class DocumentUploadTargetDto {
  @ApiProperty({ format: "date-time", type: String })
  public expiresAt!: string;

  @ApiProperty({ additionalProperties: { type: "string" }, type: Object })
  public headers!: Record<string, string>;

  @ApiProperty({ format: "uri", type: String })
  public url!: string;
}

export class CreateDocumentUploadResponseDto {
  @ApiProperty({ type: DocumentDto })
  public document!: DocumentDto;

  @ApiProperty({ type: DocumentUploadTargetDto })
  public upload!: DocumentUploadTargetDto;
}

export class DocumentDownloadDto {
  @ApiProperty({ format: "date-time", type: String })
  public expiresAt!: string;

  @ApiProperty({ format: "uri", type: String })
  public url!: string;
}

export class DocumentPublicLinkDto {
  @ApiProperty({ format: "date-time", type: String })
  public expiresAt!: string;

  @ApiProperty({ format: "uuid", type: String })
  public linkId!: string;

  @ApiProperty({ enum: ["download"], type: String })
  public scope!: "download";

  @ApiProperty({ description: "Plaintext capability returned only to the creator", type: String })
  public token!: string;
}

export class PublicDocumentDownloadDto extends DocumentDownloadDto {
  @ApiProperty({ type: DocumentDto })
  public document!: DocumentDto;
}
