/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Role management (promoting a user to admin, or revoking an admin's role -
// see POST /admin/users/:userId/role) is restricted to the one admin that
// /setup/bootstrap created, not every admin: an admin appointed later could
// otherwise promote an accomplice or demote whoever appointed them, turning
// a single account compromise into a full takeover. is_super_admin marks
// exactly that bootstrap admin; it is set nowhere else in the codebase.
//
// Backfill: a deployment that already has an admin from before this
// migration existed would otherwise end up with zero super-admins, locking
// role management forever - pick the oldest existing admin account as the
// super-admin to avoid that.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

    UPDATE app_user SET is_super_admin = TRUE
      WHERE id = (SELECT id FROM app_user WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user DROP COLUMN is_super_admin;
  `);
};
