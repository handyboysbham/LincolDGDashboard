import { ApiProperty } from "@nestjs/swagger";

export class SessionDto {
  @ApiProperty({ isArray: true, type: String })
  public permissions!: string[];

  @ApiProperty({ format: "uuid", type: String })
  public tenantId!: string;

  @ApiProperty({ format: "uuid", type: String })
  public userId!: string;
}
