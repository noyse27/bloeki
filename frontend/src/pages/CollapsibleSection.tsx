import { ReactNode, useState } from 'react';

// Every admin-area section header collapses to a clickable menu item,
// closed by default, so the admin dialog isn't a wall of open tables and
// forms on load. Children only mount once opened, which also means a
// section's own data-loading effect doesn't fire until the admin actually
// looks at it.
export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="admin-section">
      <h3 className="admin-section-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`admin-section-caret${open ? ' open' : ''}`}>▶</span>
        {title}
      </h3>
      {open && <div className="admin-section-body">{children}</div>}
    </section>
  );
}
