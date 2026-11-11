import React, { useEffect, useMemo, useRef, useState } from 'react';

// Searchable single-select. Options: [{ id, label, sub?, keywords? }]
// onCreate (optional): called with the current query when the user clicks "+ créer".
export default function SearchSelect({
  value,
  options,
  onChange,
  placeholder = 'Rechercher…',
  emptyLabel = 'Aucun résultat',
  onCreate,
  createLabel,
  disabled = false,
  allowClear = true,
  autoFocus = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(
    () => options.find((o) => String(o.id) === String(value)) || null,
    [options, value],
  );

  // Close on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = ((o.label || '') + ' ' + (o.sub || '') + ' ' + (o.keywords || '')).toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  useEffect(() => { setHighlight(0); }, [query, open]);

  function pick(opt) {
    onChange(opt?.id || '');
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight]);
      else if (onCreate && query.trim()) { onCreate(query.trim()); setOpen(false); setQuery(''); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? query : (selected?.label || '');

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          ref={inputRef}
          className="input"
          type="text"
          value={displayValue}
          placeholder={selected ? selected.label : placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          style={{ flex: 1 }}
        />
        {allowClear && selected && !disabled && (
          <button type="button" className="btn" title="Effacer"
            onClick={() => { onChange(''); setQuery(''); inputRef.current?.focus(); }}
            style={{ padding: '0 8px' }}>×</button>
        )}
      </div>

      {open && !disabled && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'white', border: '1px solid #d1d5db', borderRadius: 6,
          marginTop: 2, maxHeight: 260, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          {onCreate && (
            <div
              onMouseDown={(e) => { e.preventDefault(); onCreate(query.trim()); setOpen(false); setQuery(''); }}
              style={{
                padding: '10px 12px', cursor: 'pointer',
                borderBottom: '1px solid #e5e7eb', background: '#eff6ff',
                color: '#2563eb', fontWeight: 600, fontSize: '0.92rem',
              }}>
              + {createLabel || 'Créer'}{query.trim() ? ` « ${query.trim()} »` : ''}
            </div>
          )}
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: '0.9rem' }}>
              {emptyLabel}
            </div>
          ) : (
            filtered.map((o, idx) => (
              <div key={o.id}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setHighlight(idx)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: idx === highlight ? '#eff6ff' : 'transparent',
                  borderBottom: idx < filtered.length - 1 ? '1px solid #f3f4f6' : 'none',
                  fontSize: '0.92rem',
                }}>
                <div>{o.label}</div>
                {o.sub && <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{o.sub}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
