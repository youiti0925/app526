import { NextRequest, NextResponse } from "next/server";

// In a production app, this would use a database
// This API demonstrates the endpoint structure
export async function GET() {
  return NextResponse.json({
    message: "Projects API",
    endpoints: {
      "GET /api/projects": "List all projects",
      "POST /api/projects": "Create new project",
      "GET /api/projects/:id": "Get project details",
      "PUT /api/projects/:id": "Update project",
      "DELETE /api/projects/:id": "Delete project",
      "POST /api/projects/:id/analyze": "Start AI analysis",
      "POST /api/projects/:id/export": "Export work standard",
      "POST /api/upload": "Upload video file",
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Validate required fields
  if (!body.name) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  // In production, save to database
  const project = {
    id: crypto.randomUUID(),
    ...body,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(project, { status: 201 });
}
