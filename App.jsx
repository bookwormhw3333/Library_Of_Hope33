import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, X, Check, BookOpen, Pencil, Trash2, Stamp, Users } from 'lucide-react';
import { supabase } from './supabaseClient';

const GENRE_PALETTE = ['#7C4A2D', '#9C6B3E', '#4E3524', '#6B2430', '#2F3E2E', '#855C3B', '#5B4636', '#8B5E3C'];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function genreColor(genre) {
  if (!genre) return '#6B5744';
  return GENRE_PALETTE[hashStr(genre.trim().toLowerCase()) % GENRE_PALETTE.length];
}
function spineWidth(id) { return 108 + (hashStr(id + 'w') % 42); }
function spineHeight(id) { return 166 + (hashStr(id + 'h') % 34); }
function spineRot(id) { return (((hashStr(id + 'r') % 7) - 3) * 0.55).toFixed(2); }

function libSort(a, b) {
  const al = (a.authorLast || '').toLowerCase(), bl = (b.authorLast || '').toLowerCase();
  if (al !== bl) { if (!al) return 1; if (!bl) return -1; return al.localeCompare(bl); }
  const af = (a.authorFirst || '').toLowerCase(), bf = (b.authorFirst || '').toLowerCase();
  if (af !== bf) return af.localeCompare(bf);
  return a.title.localeCompare(b.title);
}

function compareBooks(a, b, col, dir) {
  let res = 0;
  switch (col) {
    case 'title': res = a.title.localeCompare(b.title); break;
    case 'author': res = ((a.authorLast||'') + (a.authorFirst||'')).localeCompare((b.authorLast||'') + (b.authorFirst||'')); break;
    case 'genre': res = (a.genre || '').localeCompare(b.genre || ''); break;
    case 'series': res = (a.seriesName || '').localeCompare(b.seriesName || '') || (Number(a.seriesNumber) || 0) - (Number(b.seriesNumber) || 0); break;
    case 'read': res = Number(a.read) - Number(b.read); break;
    case 'lent': res = Number(!!a.lentTo) - Number(!!b.lentTo); break;
    case 'stamped': res = Number(a.stamped) - Number(b.stamped); break;
    default: res = 0;
  }
  return dir === 'asc' ? res : -res;
}

function getMissing(group, info) {
  const owned = new Set(group.books.map(b => Number(b.seriesNumber)).filter(n => !isNaN(n) && n > 0));
  if (info && Array.isArray(info.books) && info.books.length) {
    return info.books.filter(item => !owned.has(Number(item.number)));
  }
  if (info && info.total) {
    const missing = [];
    for (let n = 1; n <= info.total; n++) if (!owned.has(n)) missing.push({ number: n, title: null });
    return missing;
  }
  return null;
}

// --- Supabase <-> app shape mapping (Postgres columns are snake_case) ---
function toRow(b) {
  return {
    id: b.id, title: b.title, author_first: b.authorFirst, author_last: b.authorLast,
    genre: b.genre, series_name: b.seriesName || null, series_number: b.seriesNumber || null,
    read: !!b.read, lent_to: b.lentTo || null, stamped: !!b.stamped, added_at: b.addedAt,
  };
}
function fromRow(r) {
  return {
    id: r.id, title: r.title, authorFirst: r.author_first || '', authorLast: r.author_last || '',
    genre: r.genre || '', seriesName: r.series_name || '', seriesNumber: r.series_number || '',
    read: !!r.read, lentTo: r.lent_to || '', stamped: !!r.stamped, addedAt: r.added_at,
  };
}

const emptyForm = {
  title: '', authorFirst: '', authorLast: '', genre: '',
  hasSeries: false, seriesName: '', seriesNumber: '',
  read: false, lentOut: false, lentTo: '', stamped: false,
};

function TotalInput({ onSet }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="number" min="1" placeholder="Total #" value={val} onChange={e => setVal(e.target.value)}
        style={{ width: 74, padding: '7px 8px', borderRadius: 8, border: '1px solid #D8C7A6', background: 'var(--paper)', fontSize: 13 }} />
      <button onClick={() => val && onSet(val)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--brass)', background: 'transparent', color: 'var(--ink)', fontSize: 13, cursor: 'pointer' }}>Set total</button>
    </div>
  );
}

export default function App() {
  const [books, setBooks] = useState(null);
  const [seriesInfo, setSeriesInfo] = useState({});
  const [loadError, setLoadError] = useState(null); // 'setup' | error message | null
  const [banner, setBanner] = useState(null);
  const [query, setQuery] = useState('');
  const [readFilter, setReadFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('shelf');
  const [sortCol, setSortCol] = useState('author');
  const [sortDir, setSortDir] = useState('asc');
  const [modalMode, setModalMode] = useState(null);
  const [activeBook, setActiveBook] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) { setLoadError('setup'); setBooks([]); return; }
      try {
        const { data: bookRows, error: bErr } = await supabase.from('books').select('*');
        if (bErr) throw bErr;
        const { data: seriesRows, error: sErr } = await supabase.from('series_info').select('*');
        if (sErr) throw sErr;
        if (cancelled) return;
        setBooks((bookRows || []).map(fromRow));
        const infoMap = {};
        (seriesRows || []).forEach(r => {
          infoMap[r.series_name] = { total: r.total, books: r.books, lookedUpAt: r.looked_up_at };
        });
        setSeriesInfo(infoMap);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e.message || 'Could not connect to the database.');
        setBooks([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function flashBanner(msg) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 4000);
  }

  async function addBookRow(payload) {
    const { error } = await supabase.from('books').insert(toRow(payload));
    if (error) { flashBanner(`Couldn't save: ${error.message}`); return; }
    setBooks(prev => [...prev, payload]);
  }
  async function updateBookRow(payload) {
    const { error } = await supabase.from('books').update(toRow(payload)).eq('id', payload.id);
    if (error) { flashBanner(`Couldn't save: ${error.message}`); return; }
    setBooks(prev => prev.map(b => (b.id === payload.id ? payload : b)));
  }
  async function deleteBookRow(id) {
    const { error } = await supabase.from('books').delete().eq('id', id);
    if (error) { flashBanner(`Couldn't delete: ${error.message}`); return; }
    setBooks(prev => prev.filter(b => b.id !== id));
  }
  async function setSeriesTotal(seriesName, total) {
    const n = Number(total);
    if (!n || n < 1) return;
    const existing = seriesInfo[seriesName] || {};
    const { error } = await supabase.from('series_info').upsert({
      series_name: seriesName, total: n, books: existing.books || null, looked_up_at: existing.lookedUpAt || null,
    });
    if (error) { flashBanner(`Couldn't save: ${error.message}`); return; }
    setSeriesInfo(prev => ({ ...prev, [seriesName]: { ...existing, total: n } }));
  }

  const genres = useMemo(() => books ? Array.from(new Set(books.map(b => b.genre).filter(Boolean))).sort() : [], [books]);

  const filtered = useMemo(() => {
    if (!books) return [];
    let list = books;
    if (readFilter === 'read') list = list.filter(b => b.read);
    if (readFilter === 'unread') list = list.filter(b => !b.read);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(b => [b.title, b.authorFirst, b.authorLast, b.genre, b.seriesName, b.lentTo]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return list;
  }, [books, query, readFilter]);

  const shelfBooks = useMemo(() => {
    const sorted = [...filtered].sort(libSort);
    return sorted.map((b, i, arr) => {
      const letter = (b.authorLast || '#').trim()[0]?.toUpperCase() || '#';
      const prevLetter = i > 0 ? ((arr[i - 1].authorLast || '#').trim()[0]?.toUpperCase() || '#') : null;
      return { ...b, _letter: letter, _showLetterTab: letter !== prevLetter };
    });
  }, [filtered]);

  const shelves = useMemo(() => {
    const rows = []; const perRow = 7;
    for (let i = 0; i < shelfBooks.length; i += perRow) rows.push(shelfBooks.slice(i, i + perRow));
    return rows;
  }, [shelfBooks]);

  const spreadsheetRows = useMemo(() => [...filtered].sort((a, b) => compareBooks(a, b, sortCol, sortDir)), [filtered, sortCol, sortDir]);

  const seriesGroups = useMemo(() => {
    if (!books) return [];
    const map = {};
    books.forEach(b => {
      if (!b.seriesName) return;
      if (!map[b.seriesName]) map[b.seriesName] = { name: b.seriesName, books: [] };
      map[b.seriesName].books.push(b);
    });
    const groups = Object.values(map).map(g => ({ ...g, books: [...g.books].sort((a, b) => (Number(a.seriesNumber) || 0) - (Number(b.seriesNumber) || 0)) }));
    groups.sort((a, b) => {
      const missA = getMissing(a, seriesInfo[a.name]), missB = getMissing(b, seriesInfo[b.name]);
      const incA = missA === null || missA.length > 0, incB = missB === null || missB.length > 0;
      if (incA !== incB) return incA ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return groups;
  }, [books, seriesInfo]);

  const incompleteCount = seriesGroups.filter(g => { const m = getMissing(g, seriesInfo[g.name]); return m === null || m.length > 0; }).length;

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  }

  function openAdd() { setForm(emptyForm); setActiveBook(null); setModalMode('add'); }
  function openView(book) { setActiveBook(book); setModalMode('view'); }
  function openEdit(book) {
    setForm({
      title: book.title, authorFirst: book.authorFirst, authorLast: book.authorLast, genre: book.genre,
      hasSeries: !!book.seriesName, seriesName: book.seriesName || '', seriesNumber: book.seriesNumber || '',
      read: !!book.read, lentOut: !!book.lentTo, lentTo: book.lentTo || '', stamped: !!book.stamped,
    });
    setActiveBook(book); setModalMode('edit');
  }
  function closeModal() { setModalMode(null); setActiveBook(null); }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = {
      id: activeBook ? activeBook.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: form.title.trim(), authorFirst: form.authorFirst.trim(), authorLast: form.authorLast.trim(),
      genre: form.genre.trim(),
      seriesName: form.hasSeries ? form.seriesName.trim() : '',
      seriesNumber: form.hasSeries ? form.seriesNumber.trim() : '',
      read: !!form.read,
      lentTo: form.lentOut ? form.lentTo.trim() : '',
      stamped: !!form.stamped,
      addedAt: activeBook ? activeBook.addedAt : Date.now(),
    };
    if (activeBook) await updateBookRow(payload);
    else await addBookRow(payload);
    setSaving(false); closeModal();
  }
  async function handleDelete() {
    if (!activeBook) return;
    await deleteBookRow(activeBook.id);
    closeModal();
  }
  async function toggleRead(book) {
    const updated = { ...book, read: !book.read };
    await updateBookRow(updated);
    setActiveBook(updated);
  }

  function quickAddMissing(seriesName, authorFirst, authorLast, number, title) {
    setForm({
      title: title || `Book ${number}`, authorFirst: authorFirst || '', authorLast: authorLast || '',
      genre: '', hasSeries: true, seriesName, seriesNumber: String(number),
      read: false, lentOut: false, lentTo: '', stamped: false,
    });
    setActiveBook(null); setModalMode('add');
  }

  const total = books ? books.length : 0;
  const readCount = books ? books.filter(b => b.read).length : 0;
  const seriesCount = books ? new Set(books.filter(b => b.seriesName).map(b => b.seriesName)).size : 0;
  const stampedCount = books ? books.filter(b => b.stamped).length : 0;
  const lentBooks = useMemo(() => (books ? books.filter(b => b.lentTo).sort((a, b) => a.lentTo.localeCompare(b.lentTo)) : []), [books]);
  const lentCount = lentBooks.length;

  async function markReturned(book) {
    const updated = { ...book, lentTo: '' };
    await updateBookRow(updated);
  }

  const inputStyle = { width: '100%', marginTop: 4, padding: '9px 10px', borderRadius: 8, border: '1px solid #D8C7A6', background: 'var(--paper)', fontSize: 14, color: 'var(--ink)' };
  const labelStyle = { fontSize: 12, color: 'var(--ink-soft)', fontFamily: "'Cormorant Garamond', serif", letterSpacing: '0.02em' };
  const eyebrow = { fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 12, color: 'var(--ink-soft)', margin: 0 };

  const TABS = [
    { id: 'shelf', label: 'The Shelf' },
    { id: 'lending', label: `Checked Out${lentCount ? ` (${lentCount})` : ''}` },
    { id: 'complete', label: `To Complete${incompleteCount ? ` (${incompleteCount})` : ''}` },
    { id: 'spreadsheet', label: 'Full Catalog' },
  ];

  // --- Setup screen if Supabase env vars are missing ---
  if (loadError === 'setup') {
    return (
      <div style={{ minHeight: '100vh', background: '#F6EEDF', color: '#2A1D14', fontFamily: 'Georgia, serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 480, background: '#EFE0C4', border: '1px solid #D8C7A6', borderRadius: 12, padding: 28 }}>
          <h1 style={{ marginTop: 0, fontSize: 22 }}>Almost there</h1>
          <p>This site needs your Supabase credentials before it can load your library.</p>
          <p>Create a <code>.env</code> file (copy <code>.env.example</code>) with your project's <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server — or, if this is deployed, add those two variables in your host's environment settings and redeploy.</p>
          <p style={{ marginBottom: 0 }}>See the README for the full setup walkthrough.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lib-root" style={{ minHeight: '100vh', background: 'var(--paper)', fontFamily: "'Source Serif 4', serif", color: 'var(--ink)' }}>
      <style>{`
        .lib-root { --paper:#F6EEDF; --paper-deep:#EFE0C4; --wood-dark:#3B2A1E; --wood-mid:#6B4A31; --ink:#2A1D14; --ink-soft:#6B5744; --brass:#A9822F; --brass-soft:#C9A227; --oxblood:#6B2430; --hunter:#2F3E2E; }
        .font-display { font-family: 'Fraunces', serif; }
        .font-label { font-family: 'Cormorant Garamond', serif; }
        .spine-btn { transform: rotate(var(--rot, 0deg)); transition: transform .15s ease, box-shadow .15s ease; }
        .spine-btn:hover, .spine-btn:focus-visible { transform: translateY(-8px) rotate(var(--rot, 0deg)); }
        .spine-btn:focus-visible { outline: 2px solid var(--brass-soft); outline-offset: 3px; }
        .chip { transition: background .15s ease, color .15s ease, border-color .15s ease; }
        .tab-btn { transition: background .15s ease, color .15s ease; }
        th.sortable:hover { color: var(--brass-soft) !important; }
        input::placeholder { color: #9C8768; }
        tbody tr:hover { background: rgba(169,130,47,0.10) !important; }
        ::selection { background: var(--brass-soft); color: var(--wood-dark); }
      `}</style>

      {banner && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'var(--oxblood)', color: '#F3E7CE', padding: '10px 18px', borderRadius: 8, fontSize: 14, zIndex: 100, boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
          {banner}
        </div>
      )}

      <header style={{ background: 'linear-gradient(180deg, var(--wood-dark), #2c1f15)', padding: '2rem 1.5rem', boxShadow: '0 6px 16px rgba(0,0,0,0.25)' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            border: '2px solid var(--brass-soft)', boxShadow: '0 0 0 3px rgba(201,162,39,0.25)',
            background: 'radial-gradient(circle at 35% 30%, #4a3624, var(--wood-dark))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600, color: 'var(--brass-soft)', fontSize: 19, letterSpacing: '0.02em' }}>LoH</span>
          </div>
          <div>
            <p style={{ ...eyebrow, color: 'var(--brass-soft)' }}>A Personal Collection</p>
            <h1 className="font-display" style={{ color: '#F3E7CE', fontSize: 'clamp(26px,4vw,38px)', margin: 0, fontWeight: 600, letterSpacing: '0.01em' }}>Library of Hope</h1>
            <p style={{ color: '#C9B79C', marginTop: 6, marginBottom: 0, fontSize: 13 }}>
              {books === null ? 'Opening the shelves…' : `${total} book${total === 1 ? '' : 's'} · ${readCount} read · ${seriesCount} series · ${stampedCount} stamped${lentCount ? ` · ${lentCount} lent out` : ''}`}
            </p>
          </div>
        </div>
      </header>

      <div style={{ background: 'var(--wood-dark)' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', gap: 4, padding: '0 1.5rem' }}>
          {TABS.map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setActiveTab(t.id)} style={{
              padding: '11px 18px', border: 'none', cursor: 'pointer', marginTop: 8,
              background: activeTab === t.id ? 'var(--brass)' : 'transparent',
              color: activeTab === t.id ? '#2E2010' : '#D8C7A6',
              fontFamily: "'Cormorant Garamond', serif", fontSize: 15, letterSpacing: '0.03em',
              fontWeight: activeTab === t.id ? 700 : 500, borderRadius: '7px 7px 0 0',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {(activeTab === 'shelf' || activeTab === 'spreadsheet') && (
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.25rem 1.5rem 0' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-soft)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search title, author, genre, series…"
                style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 10, border: '1px solid #D8C7A6', background: 'var(--paper-deep)', color: 'var(--ink)', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['all', 'unread', 'read'].map(f => (
                <button key={f} className="chip" onClick={() => setReadFilter(f)} style={{
                  padding: '9px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  border: `1px solid ${readFilter === f ? 'var(--brass)' : '#D8C7A6'}`,
                  background: readFilter === f ? 'var(--brass)' : 'transparent',
                  color: readFilter === f ? '#2E2010' : 'var(--ink-soft)', fontWeight: readFilter === f ? 600 : 400,
                }}>{f === 'all' ? 'All' : f === 'unread' ? 'To Read' : 'Read'}</button>
              ))}
            </div>
            {activeTab === 'shelf' && (
              <button onClick={() => setLegendOpen(v => !v)} className="chip" style={{
                padding: '9px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${legendOpen ? 'var(--brass)' : '#D8C7A6'}`,
                background: legendOpen ? 'var(--brass)' : 'transparent',
                color: legendOpen ? '#2E2010' : 'var(--ink-soft)', fontWeight: legendOpen ? 600 : 400,
              }}>{legendOpen ? 'Hide Legend' : 'Legend'}</button>
            )}
            <button onClick={openAdd} className="font-display" style={{ marginLeft: activeTab === 'shelf' ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--brass)', color: '#2E2010', fontWeight: 600, fontSize: 14, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
              <Plus size={16} /> Add Book
            </button>
          </div>
          {activeTab === 'shelf' && legendOpen && (
            <div style={{ marginTop: 14, padding: '14px 18px', background: 'var(--paper-deep)', border: '1px solid #D8C7A6', borderRadius: 10, display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span className="font-label" style={{ background: 'var(--brass)', color: '#2E2010', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>A</span>
                <span>Marks the start of a new author-surname letter, like a shelf label</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--brass-soft)', fontSize: 16 }}>★</span>
                <span>You've marked this book as read</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 11, height: 20, background: 'var(--hunter)', clipPath: 'polygon(0 0, 100% 0, 100% 76%, 50% 100%, 0 76%)', display: 'inline-block' }} />
                <span>Currently checked out / lent to someone</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--oxblood)', border: '1.5px solid var(--brass-soft)', display: 'inline-block' }} />
                <span>Stamped with the "Library of Hope" emboss</span>
              </div>
            </div>
          )}
        </div>
      )}
      {(activeTab === 'complete' || activeTab === 'lending') && (
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.25rem 1.5rem 0', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={openAdd} className="font-display" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--brass)', color: '#2E2010', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            <Plus size={16} /> Add Book
          </button>
        </div>
      )}

      <main style={{ maxWidth: 980, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        {books === null && <p style={{ color: 'var(--ink-soft)' }}>Loading your library…</p>}
        {loadError && loadError !== 'setup' && (
          <p style={{ color: 'var(--oxblood)', marginBottom: 16 }}>Couldn't load your library: {loadError}</p>
        )}

        {books !== null && books.length === 0 && !loadError && (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', border: '1px dashed #D8C7A6', borderRadius: 16, background: 'var(--paper-deep)' }}>
            <BookOpen size={28} style={{ color: 'var(--brass)', marginBottom: 10 }} />
            <p className="font-display" style={{ fontSize: 20, marginBottom: 6 }}>The shelves are empty</p>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 16 }}>Add the first book to start your catalog.</p>
            <button onClick={openAdd} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--brass)', color: '#2E2010', fontWeight: 600, cursor: 'pointer' }}>Add a Book</button>
          </div>
        )}

        {activeTab === 'shelf' && books !== null && books.length > 0 && shelfBooks.length === 0 && (
          <p style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: '3rem 0' }}>No books match your search.</p>
        )}

        {activeTab === 'shelf' && shelves.map((row, ri) => (
          <div key={ri} style={{ marginBottom: 30 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', paddingTop: 18, paddingBottom: 14 }}>
              {row.map(book => (
                <button key={book.id} onClick={() => openView(book)} className="spine-btn" title={book.title}
                  style={{
                    '--rot': `${spineRot(book.id)}deg`,
                    width: spineWidth(book.id), height: spineHeight(book.id),
                    background: `linear-gradient(180deg, ${genreColor(book.genre)}, ${genreColor(book.genre)}dd)`,
                    borderRadius: '2px 2px 3px 3px', border: 'none', cursor: 'pointer', position: 'relative',
                    boxShadow: 'inset -3px 0 6px rgba(0,0,0,0.28), inset 3px 0 4px rgba(255,255,255,0.10), 0 6px 10px rgba(0,0,0,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 6px',
                  }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--brass-soft), var(--brass), var(--brass-soft))', borderRadius: '2px 2px 0 0' }} />
                  <div style={{ position: 'absolute', top: 14, left: 0, right: 0, height: 64, pointerEvents: 'none',
                    background: 'repeating-linear-gradient(to bottom, rgba(0,0,0,0.24) 0 3px, rgba(255,255,255,0.10) 3px 5px, transparent 5px 17px)' }} />
                  {book._showLetterTab && (
                    <span className="font-label" style={{ position: 'absolute', top: -15, left: 4, background: 'var(--brass)', color: '#2E2010', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: '4px 4px 0 0', letterSpacing: '0.04em', boxShadow: '0 -1px 3px rgba(0,0,0,0.2)' }}>
                      {book._letter}
                    </span>
                  )}
                  {book.lentTo && (
                    <span title={`Lent to ${book.lentTo}`} style={{ position: 'absolute', top: -8, right: 16, width: 11, height: 36, background: 'var(--hunter)', clipPath: 'polygon(0 0, 100% 0, 100% 76%, 50% 100%, 0 76%)', boxShadow: '0 2px 3px rgba(0,0,0,0.3)' }} />
                  )}
                  {book.stamped && (
                    <span title="Stamped — Library of Hope" style={{ position: 'absolute', top: 8, right: 6, width: 11, height: 11, borderRadius: '50%', background: 'var(--oxblood)', border: '1.5px solid var(--brass-soft)', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }} />
                  )}
                  <span style={{
                    writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: '#F3E7CE', fontSize: 13,
                    fontWeight: 600, letterSpacing: '0.02em', fontFamily: "'Fraunces', serif",
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: '85%',
                    textShadow: '0 1px 1px rgba(0,0,0,0.35)',
                  }}>{book.title}</span>
                  {book.read && (
                    <span style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', color: 'var(--brass-soft)', fontSize: 12, textShadow: '0 1px 1px rgba(0,0,0,0.4)' }}>★</span>
                  )}
                </button>
              ))}
            </div>
            <div style={{ height: 16, borderRadius: 4, background: 'linear-gradient(180deg, var(--wood-mid), var(--wood-dark))', boxShadow: '0 8px 10px -4px rgba(0,0,0,0.35)' }} />
          </div>
        ))}

        {activeTab === 'lending' && (
          books === null ? null : lentBooks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', border: '1px dashed #D8C7A6', borderRadius: 16, background: 'var(--paper-deep)' }}>
              <Users size={26} style={{ color: 'var(--brass)', marginBottom: 10 }} />
              <p className="font-display" style={{ fontSize: 18, marginBottom: 6 }}>Nothing checked out</p>
              <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>Mark a book as lent from its detail view and it'll show up here.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lentBooks.map(book => (
                <div key={book.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: 'var(--paper-deep)', border: '1px solid #D8C7A6', borderRadius: 12, padding: '14px 18px' }}>
                  <div>
                    <p className="font-display" style={{ margin: 0, fontSize: 16, fontWeight: 600, cursor: 'pointer' }} onClick={() => openView(book)}>{book.title}</p>
                    <p style={{ margin: 0, marginTop: 3, fontSize: 13, color: 'var(--ink-soft)' }}>
                      {book.authorFirst || book.authorLast ? `${book.authorFirst} ${book.authorLast}`.trim() + ' · ' : ''}
                      Lent to <strong style={{ color: 'var(--hunter)' }}>{book.lentTo}</strong>
                    </p>
                  </div>
                  <button onClick={() => markReturned(book)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--brass)', background: 'transparent', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Mark Returned
                  </button>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'spreadsheet' && (
          books === null ? null : filtered.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)', textAlign: 'center', padding: '3rem 0' }}>No books match your search.</p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #D8C7A6', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'var(--paper-deep)' }}>
                <thead>
                  <tr style={{ background: 'var(--wood-dark)' }}>
                    {[['title', 'Title'], ['author', 'Author (Last, First)'], ['genre', 'Genre'], ['series', 'Series'], ['read', 'Read'], ['lent', 'Lent To'], ['stamped', 'Stamped']].map(([col, label]) => (
                      <th key={col} className="sortable" onClick={() => handleSort(col)} style={{ cursor: 'pointer', padding: '11px 14px', textAlign: 'left', fontFamily: "'Cormorant Garamond', serif", fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase', color: sortCol === col ? 'var(--brass-soft)' : '#F3E7CE', whiteSpace: 'nowrap' }}>
                        {label}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {spreadsheetRows.map((b, i) => (
                    <tr key={b.id} onClick={() => openView(b)} style={{ cursor: 'pointer', background: i % 2 ? 'rgba(169,130,47,0.06)' : 'transparent', borderTop: '1px solid #E4D6B8' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{b.title}</td>
                      <td style={{ padding: '10px 14px' }}>{b.authorLast || b.authorFirst ? `${b.authorLast || '—'}${b.authorFirst ? `, ${b.authorFirst}` : ''}` : '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{b.genre || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{b.seriesName ? `${b.seriesName}${b.seriesNumber ? ` #${b.seriesNumber}` : ''}` : '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{b.read ? '★ Read' : '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{b.lentTo || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{b.stamped ? '● Stamped' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {activeTab === 'complete' && (
          books === null ? null : seriesGroups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', border: '1px dashed #D8C7A6', borderRadius: 16, background: 'var(--paper-deep)' }}>
              <Users size={26} style={{ color: 'var(--brass)', marginBottom: 10 }} />
              <p className="font-display" style={{ fontSize: 18, marginBottom: 6 }}>No series on the shelf yet</p>
              <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>Mark a book as part of a series and it'll show up here.</p>
            </div>
          ) : (
            <>
              <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginTop: 0, marginBottom: 20 }}>
                Set how many books are in each series to see exactly what's left to buy.
              </p>
              {seriesGroups.map(group => {
                const info = seriesInfo[group.name];
                const missing = getMissing(group, info);
                return (
                  <div key={group.name} style={{ background: 'var(--paper-deep)', border: '1px solid #D8C7A6', borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                      <p className="font-display" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{group.name}</p>
                      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>{group.books.length} owned{info?.total ? ` of ${info.total}` : ''}</p>
                    </div>
                    {missing === null && (
                      <div style={{ marginTop: 10 }}>
                        <TotalInput onSet={(n) => setSeriesTotal(group.name, n)} />
                      </div>
                    )}
                    {missing !== null && missing.length === 0 && (
                      <p style={{ marginTop: 10, fontSize: 14, color: 'var(--hunter)', fontWeight: 600 }}>✓ Complete set</p>
                    )}
                    {missing !== null && missing.length > 0 && (
                      <ul style={{ marginTop: 12, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {missing.map(m => (
                          <li key={m.number} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '8px 10px', background: 'var(--paper)', borderRadius: 8, border: '1px solid #E4D6B8' }}>
                            <span>Book {m.number}{m.title ? ` — ${m.title}` : ''}</span>
                            <button onClick={() => quickAddMissing(group.name, group.books[0].authorFirst, group.books[0].authorLast, m.number, m.title)}
                              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--brass)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>+ Got it</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </>
          )
        )}
      </main>

      {modalMode && (
        <div onClick={closeModal} style={{ position: 'fixed', inset: 0, background: 'rgba(42,29,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 430, maxHeight: '90vh', overflowY: 'auto', background: 'var(--paper-deep)', borderRadius: 14, border: '1px solid var(--brass)', boxShadow: '0 20px 40px rgba(0,0,0,0.35), 0 0 0 4px rgba(169,130,47,0.15)' }}>
            <div style={{ padding: '18px 22px', borderBottom: '2px double var(--brass)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--paper-deep)' }}>
              <p className="font-display" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                {modalMode === 'add' ? 'New Book' : modalMode === 'edit' ? 'Edit Book' : activeBook?.title}
              </p>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)' }}><X size={18} /></button>
            </div>

            {modalMode === 'view' && activeBook && (
              <div style={{ padding: '20px 22px' }}>
                <p className="font-label" style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Author</p>
                <p style={{ margin: 0, marginBottom: 14, fontSize: 15 }}>{activeBook.authorFirst} {activeBook.authorLast}</p>
                <p className="font-label" style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Genre</p>
                <p style={{ margin: 0, marginBottom: 14, fontSize: 15 }}>{activeBook.genre || '—'}</p>
                {activeBook.seriesName && (<>
                  <p className="font-label" style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Series</p>
                  <p style={{ margin: 0, marginBottom: 14, fontSize: 15 }}>{activeBook.seriesName}{activeBook.seriesNumber ? `, Book ${activeBook.seriesNumber}` : ''}</p>
                </>)}
                {activeBook.lentTo && (<>
                  <p className="font-label" style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lent to</p>
                  <p style={{ margin: 0, marginBottom: 14, fontSize: 15 }}>{activeBook.lentTo}</p>
                </>)}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                  <button onClick={() => toggleRead(activeBook)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: `1px solid ${activeBook.read ? 'var(--brass)' : '#D8C7A6'}`, background: activeBook.read ? 'var(--brass)' : 'transparent', color: activeBook.read ? '#2E2010' : 'var(--ink-soft)', fontSize: 14, cursor: 'pointer' }}>
                    <Check size={15} /> {activeBook.read ? 'Read' : 'Mark as read'}
                  </button>
                  {activeBook.stamped && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--oxblood)', color: 'var(--oxblood)', fontSize: 14 }}>
                      <Stamp size={15} /> Stamped
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => openEdit(activeBook)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 10, border: '1px solid #D8C7A6', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', fontSize: 14 }}><Pencil size={14} /> Edit</button>
                  <button onClick={handleDelete} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 10, border: '1px solid #C98A6B', background: 'transparent', color: 'var(--oxblood)', cursor: 'pointer', fontSize: 14 }}><Trash2 size={14} /> Delete</button>
                </div>
              </div>
            )}

            {(modalMode === 'add' || modalMode === 'edit') && (
              <form onSubmit={handleSave} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={labelStyle}>Title
                  <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} />
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label style={{ ...labelStyle, flex: 1 }}>First name
                    <input value={form.authorFirst} onChange={e => setForm({ ...form, authorFirst: e.target.value })} style={inputStyle} />
                  </label>
                  <label style={{ ...labelStyle, flex: 1 }}>Last name
                    <input value={form.authorLast} onChange={e => setForm({ ...form, authorLast: e.target.value })} style={inputStyle} />
                  </label>
                </div>
                <label style={labelStyle}>Genre
                  <input list="genre-list" value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} style={inputStyle} />
                  <datalist id="genre-list">{genres.map(g => <option key={g} value={g} />)}</datalist>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.hasSeries} onChange={e => setForm({ ...form, hasSeries: e.target.checked })} />
                  Part of a series
                </label>
                {form.hasSeries && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <label style={{ ...labelStyle, flex: 2 }}>Series name
                      <input value={form.seriesName} onChange={e => setForm({ ...form, seriesName: e.target.value })} style={inputStyle} />
                    </label>
                    <label style={{ ...labelStyle, flex: 1 }}>Book #
                      <input value={form.seriesNumber} onChange={e => setForm({ ...form, seriesNumber: e.target.value })} style={inputStyle} />
                    </label>
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.read} onChange={e => setForm({ ...form, read: e.target.checked })} />
                  I've read this book
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.lentOut} onChange={e => setForm({ ...form, lentOut: e.target.checked })} />
                  Currently checked out / lent to someone
                </label>
                {form.lentOut && (
                  <label style={labelStyle}>Lent to
                    <input value={form.lentTo} onChange={e => setForm({ ...form, lentTo: e.target.value })} placeholder="Name" style={inputStyle} />
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.stamped} onChange={e => setForm({ ...form, stamped: e.target.checked })} />
                  Stamped with the "Library of Hope" emboss
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button type="submit" disabled={saving} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--brass)', color: '#2E2010', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>{saving ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={closeModal} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #D8C7A6', background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
