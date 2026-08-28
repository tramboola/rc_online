import { createProductionDriveSessionResponse } from "../admin/drive-sessions/route";

export async function POST(request: Request): Promise<Response> {
  return createProductionDriveSessionResponse(request, { requireAdmin: false });
}
