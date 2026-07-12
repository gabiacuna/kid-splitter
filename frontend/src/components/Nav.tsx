import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Nav() {
  const { teacher, logout } = useAuth();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/cohorts" className="nav-logo">
          <span className="nav-logo-icon material-symbols-outlined">groups_3</span>
          kid splitter
        </Link>
        {teacher && (
          <div className="nav-right">
            <span className="nav-school">{teacher.school_name}</span>
            <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }} onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
