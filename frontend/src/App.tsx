import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import CohortDashboardPage from './pages/CohortDashboardPage'
import CohortDetailPage from './pages/CohortDetailPage'
import SolutionDetailPage from './pages/SolutionDetailPage'
import PublicSharePage from './pages/PublicSharePage'
import ProfilePage from './pages/ProfilePage'
import AccountDeletedPage from './pages/AccountDeletedPage'
import { LanguageProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionBanner from './components/ConnectionBanner'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

const queryClient = new QueryClient({
  defaultOptions: {
    // One retry for network/5xx; a 4xx won't change on retry, so show it straight away.
    queries: {
      retry: (count, err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return count < 1;
      },
      staleTime: 30_000,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <LanguageProvider>
              <ConnectionBanner />
              <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/cohorts" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/cohorts" element={<ProtectedRoute><CohortDashboardPage /></ProtectedRoute>} />
                <Route path="/cohorts/:id" element={<ProtectedRoute><CohortDetailPage /></ProtectedRoute>} />
                <Route path="/solutions/:id" element={<ProtectedRoute><SolutionDetailPage /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
                <Route path="/account-deleted" element={<AccountDeletedPage />} />
                <Route path="/share/:token" element={<PublicSharePage />} />
                <Route path="*" element={<Navigate to="/cohorts" replace />} />
              </Routes>
              </ErrorBoundary>
            </LanguageProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
