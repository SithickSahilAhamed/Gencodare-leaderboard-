import * as XLSX from 'xlsx';
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { auth, db } from './firebase';
import './styles.css';

const EVENT_NAME = import.meta.env.VITE_EVENT_NAME || 'Hackathon Leaderboard';
const MAX_MARKS = Number(import.meta.env.VITE_MAX_MARKS || 100);

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortAndRankTeams(rawTeams) {
  const sorted = [...rawTeams].sort((a, b) => {
    if (b.marks !== a.marks) return b.marks - a.marks;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  let previousMarks = null;
  let rank = 0;

  return sorted.map((team, index) => {
    if (team.marks !== previousMarks) {
      rank = index + 1;
      previousMarks = team.marks;
    }

    return { ...team, rank };
  });
}

function mapTeam(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: data.name,
    nameNormalized: data.nameNormalized,
    marks: Number(data.marks ?? 0),
    updatedAt: data.updatedAt ?? data.createdAt ?? null
  };
}

async function ensureUniqueTeamName(name, ignoreId = null) {
  const normalized = normalizeName(name);
  const existing = await getDocs(
    query(collection(db, 'teams'), where('nameNormalized', '==', normalized))
  );
  return existing.docs.some((item) => item.id !== ignoreId);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportExcel(teams) {
  const rows = teams.map((team) => ({
    Rank: team.rank,
    'Team Name': team.name,
    Marks: team.marks,
    'Maximum Marks': MAX_MARKS,
    'Score Percentage': `${((team.marks / MAX_MARKS) * 100).toFixed(2)}%`,
    'Last Updated': new Date(
      toMillis(team.updatedAt) || Date.now()
    ).toLocaleString('en-IN')
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 30 },
    { wch: 12 },
    { wch: 16 },
    { wch: 20 },
    { wch: 25 }
  ];

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    'Leaderboard'
  );

  XLSX.writeFile(
    workbook,
    'hackathon-leaderboard.xlsx'
  );
}

function exportPDF(teams) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(EVENT_NAME, 105, 20, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 105, 27, { align: 'center' });

  autoTable(pdf, {
    startY: 36,
    head: [['Rank', 'Team Name', 'Marks', `Score / ${MAX_MARKS}`]],
    body: teams.map((team) => [team.rank, team.name, team.marks, `${team.marks} / ${MAX_MARKS}`]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 28 }, 3: { cellWidth: 32 } },
    didDrawPage: (data) => {
      pdf.setFontSize(8);
      pdf.text(`Page ${data.pageNumber}`, 105, 290, { align: 'center' });
    }
  });

  pdf.save('hackathon-leaderboard.pdf');
}

function App() {
  const isAdminPath = window.location.pathname.startsWith('/admin');
  return isAdminPath ? <AdminApp /> : <PublicLeaderboard />;
}

function useLeaderboard() {
  const [data, setData] = useState({ teams: [], maxMarks: MAX_MARKS });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');

    const unsubscribe = onSnapshot(
      collection(db, 'teams'),
      (snapshot) => {
        const teams = sortAndRankTeams(snapshot.docs.map(mapTeam));
        setData({ teams, maxMarks: MAX_MARKS });
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError('Could not connect to the live leaderboard. Check Firebase configuration and Firestore rules.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  return { data, loading, error };
}

function Shell({ children, admin = false }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">◆</div>
          <div>
            <div className="brand-title">{EVENT_NAME}</div>
            <div className="brand-subtitle">Live scoring system</div>
          </div>
        </div>
        <a className="top-link" href={admin ? '/' : '/admin'}>
          {admin ? 'Public Leaderboard' : 'Admin Panel'}
        </a>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}

function PublicLeaderboard() {
  const { data, loading, error } = useLeaderboard();
  const teams = data.teams || [];
  const leaders = teams.slice(0, 3);
  const lastUpdated = teams.length
    ? new Date(Math.max(...teams.map((team) => toMillis(team.updatedAt)))).toLocaleTimeString('en-IN')
    : null;

  return (
    <Shell>
      <section className="hero">
        <div>
          <div className="eyebrow">LIVE LEADERBOARD</div>
          <h1>Who is leading?</h1>
          <p>Scores update in real time. Highest score takes the highest rank.</p>
        </div>
        <div className="live-status"><span className="live-dot" /> LIVE</div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {loading && !teams.length ? (
        <div className="empty-state">Connecting to leaderboard…</div>
      ) : !teams.length ? (
        <div className="empty-state">
          <div className="empty-icon">🏁</div>
          <h2>No scores yet</h2>
          <p>The leaderboard will appear here as judges enter team scores.</p>
        </div>
      ) : (
        <>
          <section className="podium-grid">
            {leaders.map((team, index) => (
              <div key={team.id} className={`podium-card place-${index + 1}`}>
                <div className="medal">{index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</div>
                <div className="podium-rank">#{team.rank}</div>
                <div className="podium-team">{team.name}</div>
                <div className="podium-score">{team.marks}<span> / {data.maxMarks}</span></div>
              </div>
            ))}
          </section>

          <section className="leaderboard-card">
            <div className="card-header">
              <div>
                <h2>Full Rankings</h2>
                <span>{teams.length} teams</span>
              </div>
              {lastUpdated && <div className="updated">Updated {lastUpdated}</div>}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Rank</th><th>Team</th><th>Marks</th></tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id}>
                      <td><span className="rank-pill">{team.rank}</span></td>
                      <td className="team-cell">{team.name}</td>
                      <td className="score-cell">{team.marks} <small>/ {data.maxMarks}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer className="footer">Public view • Powered by Firebase Firestore real-time updates</footer>
    </Shell>
  );
}

function AdminApp() {
  const [user, setUser] = useState(undefined);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);

  if (!authReady) {
    return <Shell><div className="empty-state">Checking admin session…</div></Shell>;
  }

  if (!user) return <Login />;
  return <AdminDashboard user={user} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      console.error(err);
      setError('Invalid admin email/password, or the Firebase Authentication provider is not enabled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="auth-layout">
        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="eyebrow">ADMIN ACCESS</div>
          <h1>Sign in</h1>
          <p>Use the Firebase admin account created for your hackathon organizers.</p>
          {error && <div className="alert error">{error}</div>}
          <label>Admin email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </Shell>
  );
}

function AdminDashboard({ user }) {
  const [teams, setTeams] = useState([]);
  const [name, setName] = useState('');
  const [marks, setMarks] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'teams'),
      (snapshot) => {
        setTeams(sortAndRankTeams(snapshot.docs.map(mapTeam)));
        setLoaded(true);
      },
      (err) => {
        console.error(err);
        setMessage({ type: 'error', text: 'Could not read Firestore. Verify Firestore rules and the admin document.' });
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, []);

  const visibleTeams = useMemo(() => {
    const queryText = filter.trim().toLowerCase();
    return queryText ? teams.filter((team) => team.name.toLowerCase().includes(queryText)) : teams;
  }, [filter, teams]);

  const leader = teams[0] || null;

  function resetForm() {
    setEditingId(null);
    setName('');
    setMarks('');
  }

  async function saveTeam(event) {
    event.preventDefault();
    setMessage({ type: '', text: '' });

    const trimmedName = name.trim();
    const numericMarks = Number(marks);

    if (!trimmedName) return setMessage({ type: 'error', text: 'Enter a team name.' });
    if (!Number.isFinite(numericMarks) || numericMarks < 0 || numericMarks > MAX_MARKS) {
      return setMessage({ type: 'error', text: `Marks must be between 0 and ${MAX_MARKS}.` });
    }

    setBusy(true);
    try {
      const duplicate = await ensureUniqueTeamName(trimmedName, editingId);
      if (duplicate) {
        throw new Error('A team with this name already exists.');
      }

      const roundedMarks = Number(numericMarks.toFixed(2));
      const normalized = normalizeName(trimmedName);

      if (editingId) {
        await updateDoc(doc(db, 'teams', editingId), {
          name: trimmedName,
          nameNormalized: normalized,
          marks: roundedMarks,
          updatedAt: serverTimestamp()
        });
        setMessage({ type: 'success', text: 'Team score updated successfully.' });
      } else {
        const newRef = doc(collection(db, 'teams'));
        await setDoc(newRef, {
          name: trimmedName,
          nameNormalized: normalized,
          marks: roundedMarks,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setMessage({ type: 'success', text: 'Team added successfully.' });
      }

      resetForm();
    } catch (err) {
      console.error(err);
      const code = err?.code || '';
      if (code === 'permission-denied') {
        setMessage({ type: 'error', text: 'Permission denied. Make sure this Firebase user has an admin document.' });
      } else {
        setMessage({ type: 'error', text: err.message || 'Could not save team.' });
      }
    } finally {
      setBusy(false);
    }
  }

  function startEdit(team) {
    setEditingId(team.id);
    setName(team.name);
    setMarks(String(team.marks));
    setMessage({ type: '', text: '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteTeam(team) {
    if (!window.confirm(`Delete ${team.name} from the leaderboard?`)) return;
    try {
      await deleteDoc(doc(db, 'teams', team.id));
      setMessage({ type: 'success', text: 'Team deleted successfully.' });
      if (editingId === team.id) resetForm();
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: err?.code === 'permission-denied' ? 'Permission denied.' : 'Could not delete team.' });
    }
  }

  async function clearAll() {
    if (!teams.length) return;
    if (!window.confirm('Delete ALL teams and scores? This cannot be undone.')) return;

    setBusy(true);
    try {
      await Promise.all(teams.map((team) => deleteDoc(doc(db, 'teams', team.id))));
      resetForm();
      setMessage({ type: 'success', text: 'All leaderboard data has been cleared.' });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Could not clear all teams. Check Firestore permissions.' });
    } finally {
      setBusy(false);
    }
  }

  function handleExcel() {
  exportExcel(teams);
  setMessage({
    type: 'success',
    text: 'Excel file exported successfully.'
  });
}

  function handlePDF() {
    exportPDF(teams);
    setMessage({ type: 'success', text: 'PDF exported successfully.' });
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <Shell admin>
      <section className="admin-header">
        <div>
          <div className="eyebrow">CONTROL CENTER</div>
          <h1>Score Management</h1>
          <p>Signed in as <strong>{user.email}</strong>. Firestore changes appear on the public leaderboard immediately.</p>
        </div>
        <button className="ghost-button" onClick={logout}>Log out</button>
      </section>

      <section className="stats-grid">
        <div className="stat-card"><span>Teams</span><strong>{teams.length}</strong></div>
        <div className="stat-card"><span>Current Leader</span><strong>{leader ? leader.name : '—'}</strong></div>
        <div className="stat-card"><span>Leading Score</span><strong>{leader ? `${leader.marks}/${MAX_MARKS}` : '—'}</strong></div>
      </section>

      {message.text && <div className={`alert ${message.type === 'success' ? 'success' : 'error'}`}>{message.text}</div>}

      <section className="admin-grid">
        <form className="score-card" onSubmit={saveTeam}>
          <div className="card-header">
            <div><h2>{editingId ? 'Edit team' : 'Add team'}</h2><span>Maximum marks: {MAX_MARKS}</span></div>
          </div>
          <label>Team name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tech Titans" maxLength={120} required /></label>
          <label>Marks<input type="number" min="0" max={MAX_MARKS} step="0.01" value={marks} onChange={(e) => setMarks(e.target.value)} placeholder={`0 – ${MAX_MARKS}`} required /></label>
          <div className="form-actions">
            <button className="primary-button" disabled={busy || !loaded}>{busy ? 'Saving…' : editingId ? 'Update score' : 'Add to leaderboard'}</button>
            {editingId && <button type="button" className="ghost-button" onClick={resetForm}>Cancel</button>}
          </div>
        </form>

        <section className="export-card">
          <div className="card-header"><div><h2>Exports</h2><span>Download the current ranked data</span></div></div>
          <div className="export-buttons">
            <button type="button" className="export-button" onClick={handleExcel}>
  ⇩ Download Excel
</button>
            <button type="button" className="export-button" onClick={handlePDF}>⇩ Download PDF</button>
          </div>
          <div className="danger-zone">
            <div><strong>Danger zone</strong><span>Remove every team and score from Firestore.</span></div>
            <button type="button" className="danger-button" onClick={clearAll} disabled={busy}>Clear all</button>
          </div>
        </section>
      </section>

      <section className="leaderboard-card">
        <div className="card-header card-header-wrap">
          <div><h2>Live scoreboard</h2><span>Sorted by marks · tied marks share the same rank</span></div>
          <input className="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search team…" aria-label="Search teams" />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Team</th><th>Marks</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleTeams.map((team) => (
                <tr key={team.id}>
                  <td><span className="rank-pill">{team.rank}</span></td>
                  <td className="team-cell">{team.name}</td>
                  <td className="score-cell">{team.marks} <small>/ {MAX_MARKS}</small></td>
                  <td className="actions-cell">
                    <button type="button" className="table-button" onClick={() => startEdit(team)}>Edit</button>
                    <button type="button" className="table-button danger-text" onClick={() => deleteTeam(team)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!visibleTeams.length && <tr><td colSpan="4" className="no-results">No teams found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="footer">Admin view • Firebase Authentication + Cloud Firestore</footer>
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<App />);
