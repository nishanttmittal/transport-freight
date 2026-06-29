/**
 * App root — runs migrations once, then mounts the freight module shell.
 */
import { useState } from 'react'
import { runMigrations } from './core/db/migrations'
import AppShell from './app/AppShell'

runMigrations()

export default function App() {
  const [moduleId] = useState('freight')
  return <AppShell moduleId={moduleId} />
}
