import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ApiErrorDetailDto {
  @ApiProperty({ type: String })
  public code!: string;

  @ApiProperty({ type: String })
  public correlationId!: string;

  @ApiPropertyOptional({ type: Object })
  public details?: unknown;

  @ApiProperty({ type: String })
  public message!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorDetailDto })
  public error!: ApiErrorDetailDto;
}
