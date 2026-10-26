/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Passwort-Reset-Flow: ein Nutzer, der sein Passwort vergessen hat, markiert
// per POST /auth/request-password-reset nur password_reset_requested_at -
// das macht die Anfrage fuer den Admin in der Nutzerverwaltung sichtbar,
// ohne selbst irgendetwas am Konto zu aendern (kein Mail-Versand im System).
// Der Admin loest den eigentlichen Reset aus (POST
// /admin/users/:userId/reset-password), was ein neues Zufallspasswort setzt
// und must_change_password setzt; der naechste erfolgreiche Login mit diesem
// Temp-Passwort zeigt dem Frontend damit an, dass zwingend ueber
// POST /users/me/change-password ein neues Passwort gesetzt werden muss,
// bevor must_change_password dort wieder auf FALSE faellt.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN password_reset_requested_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      DROP COLUMN must_change_password,
      DROP COLUMN password_reset_requested_at;
  `);
};
