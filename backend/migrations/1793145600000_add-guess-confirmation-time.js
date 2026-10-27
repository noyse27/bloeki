exports.up = (pgm) => {
  pgm.addColumn('guess', { confirmed_at: { type: 'timestamptz' } });
  pgm.sql(`UPDATE guess SET confirmed_at = submitted_at WHERE guess_type = 'position'`);
};

exports.down = (pgm) => {
  pgm.dropColumn('guess', 'confirmed_at');
};
