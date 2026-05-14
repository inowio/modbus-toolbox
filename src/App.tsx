import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Screen2Layout from "./screen2/Screen2Layout";
import AboutPage from "./screen2/pages/AboutPage";
import AnalyzerPage from "./screen2/pages/AnalyzerPage";
import ConnectionPage from "./screen2/pages/ConnectionPage";
import ClientPage from "./screen2/pages/ClientPage";
import SlaveDetailPage from "./screen2/pages/SlaveDetailPage";
import SlavesPage from "./screen2/pages/SlavesPage";
import WorkspacePage from "./screen2/pages/WorkspacePage";
import WorkspaceScreen, { Workspace } from "./screens/WorkspaceScreen";

function WorkspaceRoute() {
  const navigate = useNavigate();

  return (
    <WorkspaceScreen
      onOpen={(ws: Workspace) =>
        navigate(`/app/${encodeURIComponent(ws.name)}/workspace`)
      }
    />
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceRoute />} />

      <Route path="/app/:workspaceName" element={<Screen2Layout />}>
        <Route index element={<Navigate to="workspace" replace />} />
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="analyzer" element={<AnalyzerPage />} />
        <Route path="connection" element={<ConnectionPage />} />
        <Route path="client" element={<ClientPage />} />
        <Route path="slaves" element={<SlavesPage />} />
        <Route path="slaves/:slaveId" element={<SlaveDetailPage />} />
        <Route path="about" element={<AboutPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
