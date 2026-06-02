import { locations } from '@contentful/app-sdk';
import { useSDK } from '@contentful/react-apps-toolkit';
import Sidebar from './components/Sidebar';
import ConfigScreen from './components/ConfigScreen';

export default function App() {
  const sdk = useSDK();

  if (sdk.location.is(locations.LOCATION_APP_CONFIG)) {
    return <ConfigScreen />;
  }

  if (sdk.location.is(locations.LOCATION_ENTRY_SIDEBAR)) {
    return <Sidebar />;
  }

  return (
    <main className="app-shell">
      <p className="muted">DEV Crosspost is available in the entry sidebar and app configuration locations.</p>
    </main>
  );
}

