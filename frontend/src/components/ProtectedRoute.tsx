import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { teacher, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="full-page-spinner">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  if (!teacher) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
