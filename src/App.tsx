import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CandidateList from './pages/CandidateList';
import BatchManagement from './pages/BatchManagement';
import AuditCenter from './pages/AuditCenter';
import SystemConfig from './pages/SystemConfig';
import SubsidyForms from './pages/SubsidyForms';
import Login from './pages/Login';
import DataSync from './pages/DataSync';
import TagManagement from './pages/TagManagement';
import RolePermissions from './pages/RolePermissions';
import SystemRoles from './pages/SystemRoles';
import StudentDetail from './pages/StudentDetail';
import UserManagement from './pages/UserManagement';

export default function App() {
  return (
    <Router>
      <Layout>
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
      </Layout>
    </Router>
  );
}
