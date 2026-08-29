import type { DockerTestProfile } from "../types/index.ts";

export function buildDefaultDocker(): DockerTestProfile {
  return {
    enabled: true,
    compose_file: "docker-compose.test.yml",
    containers: {
      web_app: {
        container_name: "app-web-test",
        image: "node:20-alpine",
        ports: ["3000:3000"],
        health_endpoint: "http://localhost:3000/api/health",
        ready_timeout_ms: 30000,
        env: { NODE_ENV: "test", PORT: "3000" },
      },
    },
    test_user_personas: {
      admin: {
        role: "admin",
        email: "admin@olt.local",
        password_env_var: "OLT_TEST_ADMIN_PASSWORD",
        display_name: "Test Admin",
        tenant_id: "tenant-corp-001",
        permissions: ["*"],
        mock_session_cookie: "olt_session_admin_mock_token_sec991823",
      },
      standard_user: {
        role: "standard_user",
        email: "user@olt.local",
        password_env_var: "OLT_TEST_USER_PASSWORD",
        display_name: "Standard User",
        tenant_id: "tenant-corp-001",
        permissions: ["read", "write"],
        mock_session_cookie: "olt_session_user_mock_token_usr102938",
      },
      invited_member: {
        role: "invited_member",
        email: "invited@olt.local",
        password_env_var: "OLT_TEST_INVITED_PASSWORD",
        display_name: "Invited Member",
        tenant_id: "tenant-corp-001",
        permissions: ["read"],
        mock_session_cookie: "olt_session_invited_mock_token_inv482019",
      },
      guest: {
        role: "guest",
        email: "guest@olt.local",
        password_env_var: "OLT_TEST_GUEST_PASSWORD",
        display_name: "Guest Visitor",
        tenant_id: "tenant-corp-001",
        permissions: ["public_read"],
      },
    },
    auth_paths: {
      login_url: "http://localhost:3000/login",
      logout_url: "http://localhost:3000/logout",
      signup_url: "http://localhost:3000/signup",
      session_verify_url: "http://localhost:3000/api/auth/me",
    },
    session_cookie_templates: {
      session_id: {
        name: "olt_session_id",
        domain: "localhost",
        path: "/",
        http_only: true,
        secure: false,
        same_site: "Lax",
      },
    },
  };
}
