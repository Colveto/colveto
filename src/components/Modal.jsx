import React, { useEffect } from 'react';

export default function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className="modal" style={width ? { width } : undefined}>
        <div className="flex-row between mb-4">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        {children}
        {footer && <div className="flex-row mt-4" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}
