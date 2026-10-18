// Last-resort break-glass recovery: resets ANY account's password - most
// importantly an admin's - straight on the database, for the case where
// nobody can log into /admin anymore (the single-admin-locked-out scenario
// that routes/admin.ts's POST /users/:userId/reset-password cannot cover,
// since that route itself requires an already-logged-in admin). Trust model
// matches services/setupToken.ts: whoever can run a command in the backend
// container (docker compose exec / a shell on the host) is already trusted
// as the operator, so no separate auth check is layered on top here.
//
// Usage:
//   - In the running backend container (the production/docker-compose case
//     this script exists for - no npm/npx there, see backend/Dockerfile's
//     runtime stage, only the compiled dist/ output and plain `node`):
//       docker compose exec backend node dist/scripts/resetAdminPassword.js <username-or-email>
//   - Local dev (outside Docker):
//       npm run admin:reset-password --workspace backend -- <username-or-email>
import crypto from 'crypto';
import argon2 from 'argon2';
import { pool } from '../db/pool';

async function main() {
  const usernameOrEmail = process.argv[2];
  if (!usernameOrEmail) {
    console.error('Usage: resetAdminPassword.ts <username-or-email>');
    process.exitCode = 1;
    return;
  }

  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await argon2.hash(temporaryPassword);

  const result = await pool.query(
    `UPDATE app_user
     SET password_hash = $1, must_change_password = TRUE, password_reset_requested_at = NULL,
         session_version = session_version + 1
     WHERE username = $2 OR email = $2
     RETURNING id, username, role`,
    [passwordHash, usernameOrEmail],
  );

  if (result.rowCount === 0) {
    console.error(`No account found for "${usernameOrEmail}".`);
    process.exitCode = 1;
    return;
  }

  const user = result.rows[0];
  console.log('='.repeat(72));
  console.log(`Password reset for "${user.username}" (role: ${user.role}).`);
  console.log('Temporary password:');
  console.log(`  ${temporaryPassword}`);
  console.log('They must set a new password on their next login.');
  console.log('='.repeat(72));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
