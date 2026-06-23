import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const CandidateList = lazy(() => import('./pages/CandidateList'));
const BatchManagement = lazy(() => import('./pages/BatchManagement'));
const AuditCenter = lazy(() => import('./pages/AuditCenter'));
const SystemConfig = lazy(() => import('./pages/SystemConfig'));
const SubsidyForms = lazy(() => import('./pages/SubsidyForms'));
const Login = lazy(() => import('./pages/Login'));
const DataSync = lazy(() => import('./pages/DataSync'));
const TagManagement = lazy(() => import('./pages/TagManagement'));
const RolePermissions = lazy(() => import('./pages/RolePermissions'));
const SystemRoles = lazy(() => import('./pages/SystemRoles'));
const StudentDetail = lazy(() => import('./pages/StudentDetail'));
const UserManagement = lazy(() => import('./pages/UserManagement'));

function RouteFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500">
      页面加载中...
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Layout>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/sync" element={<DataSync />} />
            <Route path="/batches" element={<BatchManagement />} />
            <Route path="/candidates" element={<CandidateList />} />
            <Route path="/students/:studentId" element={<StudentDetail />} />
            <Route path="/audit" element={<AuditCenter />} />
            <Route path="/forms" element={<SubsidyForms />} />
            <Route path="/tags" element={<TagManagement />} />
            <Route path="/roles" element={<RolePermissions />} />
            <Route path="/system-roles" element={<SystemRoles />} />
            <Route path="/user-management" element={<UserManagement />} />
            <Route path="/config" element={<SystemConfig />} />
          </Routes>
        </Suspense>
      </Layout>
    </Router>
  );
}
