import { AppShell } from './components/layout/AppShell'
import { IntelFeedProvider } from './hooks/useIntelFeed'

function App(): React.JSX.Element {
  return (
    <IntelFeedProvider>
      <AppShell />
    </IntelFeedProvider>
  )
}

export default App
