import React, { useState } from 'react';
import { Lock, ChevronDown, ChevronUp, ArrowLeft, Footprints } from 'lucide-react';
import { TEAM_MEMBERS } from '../data/team';
import { AuthUser, loginMember } from '../api/client';
import { TeamMember } from '../types';

interface LoginScreenProps {
  onSuccess: (user: AuthUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pin.length < 4) return;
    setLoading(true);
    setError('');
    try {
      const res = await loginMember(selected.id, pin);
      onSuccess(res.member);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  function appendDigit(digit: string) {
    if (pin.length >= 4 || loading) return;
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length === 4 && selected) {
      setLoading(true);
      loginMember(selected.id, next)
        .then((res) => onSuccess(res.member))
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Incorrect PIN.');
          setPin('');
        })
        .finally(() => setLoading(false));
    }
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
    setError('');
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="brand-header">
          <div className="brand-logo">
            <Footprints size={24} />
          </div>
          <h1>EcoStep Defense Prep</h1>
          <p>Team Flashcards &amp; Struggle Analytics</p>
        </div>

        {!selected ? (
          <>
            <div className="section-label">Choose your account (6 Team Members)</div>
            <div className="member-grid">
              {TEAM_MEMBERS.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="member-card"
                  onClick={() => {
                    setSelected(member);
                    setPin('');
                    setError('');
                  }}
                >
                  <div className="avatar" style={{ backgroundColor: member.avatarColor }}>
                    {member.initials}
                  </div>
                  <div className="member-card-info">
                    <div className="member-name">{member.name}</div>
                    <div className="member-role">{member.role}</div>
                  </div>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="ghost-toggle"
              onClick={() => setShowDefaults((v) => !v)}
            >
              <span>First time signing in? View starter PINs</span>
              {showDefaults ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showDefaults && (
              <div className="defaults-box">
                {TEAM_MEMBERS.map((m) => (
                  <div key={m.id} className="defaults-row">
                    <span>{m.shortName}</span>
                    <code>{m.defaultPin}</code>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <form className="pin-panel" onSubmit={handleSubmit}>
            <button
              type="button"
              className="back-btn"
              onClick={() => {
                setSelected(null);
                setPin('');
                setError('');
              }}
            >
              <ArrowLeft size={18} />
              <span>All Members</span>
            </button>

            <div className="pin-user-header">
              <div className="avatar avatar-lg" style={{ backgroundColor: selected.avatarColor }}>
                {selected.initials}
              </div>
              <h2>{selected.name}</h2>
              <p>Enter your 4-digit PIN</p>
            </div>

            <div className="pin-dots" aria-label="PIN progress">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''}`} />
              ))}
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="key-btn"
                  onClick={() => appendDigit(d)}
                  disabled={loading}
                >
                  {d}
                </button>
              ))}
              <div className="key-spacer">
                <Lock size={16} />
              </div>
              <button type="button" className="key-btn" onClick={() => appendDigit('0')} disabled={loading}>
                0
              </button>
              <button type="button" className="key-btn key-del" onClick={backspace} disabled={loading}>
                ⌫
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
