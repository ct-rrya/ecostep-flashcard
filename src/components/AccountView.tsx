import React from 'react';
import { LogOut, Wifi, WifiOff } from 'lucide-react';
import { AuthUser } from '../api/client';

interface AccountViewProps {
  user: AuthUser;
  serverOnline: boolean;
  lanUrls: string[];
  studiedCount: number;
  totalCards: number;
  onLogout: () => void;
}

export const AccountView: React.FC<AccountViewProps> = ({
  user,
  serverOnline,
  lanUrls,
  studiedCount,
  totalCards,
  onLogout,
}) => {
  return (
    <div className="account-view">
      {/* Profile card */}
      <div className="panel profile-card">
        <div className="avatar avatar-lg" style={{ backgroundColor: user.avatarColor }}>
          {user.initials}
        </div>
        <h2>{user.name}</h2>
        <div className="profile-role">{user.role} &bull; EcoStep Research Team</div>
        <div className="profile-stat">
          {studiedCount} of {totalCards} flashcards reviewed
        </div>
      </div>

      {/* Sync Status & Phone Sharing */}
      <div className="panel">
        <div className="sync-row">
          <div className="panel-title">Team Sync Status</div>
          <span className={`sync-pill ${serverOnline ? 'sync-on' : 'sync-off'}`}>
            {serverOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
            {serverOnline ? 'Live Team Server' : 'Offline Local Mode'}
          </span>
        </div>
        {serverOnline && lanUrls.length > 0 ? (
          <div className="share-box">
            <p className="panel-sub">
              Teammates on the same Wi-Fi/hotspot can open this link on their phones and sign in to their account:
            </p>
            {lanUrls.map((url) => (
              <div key={url} className="url-chip">
                <code>{url}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-sub">
            {serverOnline
              ? 'All 6 team accounts are syncing live to the shared backend database.'
              : 'Running in offline fallback mode. Start the server (npm start) to sync across all 6 members.'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="panel account-actions">
        <button type="button" className="secondary-btn full-width" onClick={onLogout}>
          <LogOut size={16} /> Switch Account / Sign Out
        </button>
      </div>
    </div>
  );
};
