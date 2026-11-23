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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <LanguageProvider>
              <Routes>
                <Route path="/" element={<Navigate to="/cohorts" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/cohorts" element={<ProtectedRoute><CohortDashboardPage /></ProtectedRoute>} />
                <Route path="/cohorts/:id" element={<ProtectedRoute><CohortDetailPage /></ProtectedRoute>} />
                <Route path="/solutions/:id" element={<ProtectedRoute><SolutionDetailPage /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
                <Route path="/account-deleted" element={<AccountDeletedPage />} />
                <Route path="/share/:token" element={<PublicSharePage />} />
                <Route path="*" element={<Navigate to="/cohorts" replace />} />
              </Routes>
            </LanguageProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
