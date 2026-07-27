import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller()
export class HealthController {
  @Get("/health/live")
  public live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("/health/ready")
  public ready() {
    return {
      status: "ready",
      checks: {
        api: true,
        database: Boolean(process.env.DATABASE_URL),
        redis: Boolean(process.env.REDIS_URL),
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get("/metrics")
  public metrics() {
    return [
      "# HELP rc_api_up Whether the API process is up",
      "# TYPE rc_api_up gauge",
      "rc_api_up 1",
      "",
    ].join("\n");
  }
}
