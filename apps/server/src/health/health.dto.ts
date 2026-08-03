import { ApiProperty } from "@nestjs/swagger";

export class LiveHealthDto {
  @ApiProperty({ example: "ok", type: String })
  public status!: "ok";

  @ApiProperty({ format: "date-time", type: String })
  public timestamp!: string;
}

export class ReadinessChecksDto {
  @ApiProperty({ enum: ["ready"], type: String })
  public database!: "ready";

  @ApiProperty({ enum: ["ready"], type: String })
  public migrations!: "ready";

  @ApiProperty({ enum: ["ready"], type: String })
  public objectStorage!: "ready";

  @ApiProperty({ enum: ["ready", "skipped"], type: String })
  public worker!: "ready" | "skipped";
}

export class ReadyHealthDto {
  @ApiProperty({ type: ReadinessChecksDto })
  public checks!: ReadinessChecksDto;

  @ApiProperty({ example: "ready", type: String })
  public status!: "ready";

  @ApiProperty({ format: "date-time", type: String })
  public timestamp!: string;
}
