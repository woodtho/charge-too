import { startTransition, useMemo, useState } from 'react'
import './App.css'
import { canonicalRooms } from './data/canonicalRooms'
import { samplePatients } from './data/samplePatients'
import {
  acuityGroups,
  assignPatientsToNurses,
  deliveryWindows,
  formatTimeline,
  getGroupMeta,
} from './utils/assignment'

const analyticsStorageKey = 'charge-prototype-analytics'
const feedbackStorageKey = 'charge-prototype-feedback'

const feedbackSeed = {
  name: '',
  role: 'Charge nurse',
  rating: '5',
  message: '',
}

function readStoredList(storageKey) {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)
    return storedValue ? JSON.parse(storedValue) : []
  } catch {
    return []
  }
}

function writeStoredList(storageKey, nextValue) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(nextValue))
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

function clonePatients(patients) {
  return patients.map((patient) => ({ ...patient }))
}

function statLabelFromGroup(groupId) {
  if (groupId === 'c-section-under-24') {
    return 'new C-sections'
  }

  if (groupId === 'vaginal-under-24') {
    return 'new vaginal'
  }

  if (groupId === 'post-24') {
    return 'over 24 hours'
  }

  return 'no timeline'
}

function buildAssignmentReport(assignment, lastBalancedAt) {
  const lines = [
    'Charge Assignment Report',
    `Balanced at: ${lastBalancedAt}`,
    `Nurses: ${assignment.nurses.length}`,
    `Room spread: ${assignment.fairness.totalSpread}`,
    `High-acuity spread: ${assignment.fairness.highAcuitySpread}`,
    '',
  ]

  assignment.nurses.forEach((nurse) => {
    lines.push(`${nurse.id} (${nurse.patientCount} rooms, score ${nurse.workloadScore})`)

    nurse.patients.forEach((patient) => {
      const groupMeta = getGroupMeta(patient.groupId)
      const detailParts = [groupMeta.shortLabel, formatTimeline(patient)]

      if (patient.notes?.trim()) {
        detailParts.push(patient.notes.trim())
      }

      lines.push(`- Room ${patient.room}: ${detailParts.join(' | ')}`)
    })

    lines.push('')
  })

  return lines.join('\n').trim()
}

const defaultSectionState = {
  setup: true,
  census: true,
  assignments: true,
  queue: false,
  validation: false,
}

function CollapsibleSection({
  sectionId,
  isOpen,
  onToggle,
  eyebrow,
  title,
  badge,
  toolbar,
  action,
  summary,
  children,
}) {
  return (
    <section
      className={`surface section-card accordion-card ${isOpen ? 'is-open' : 'is-collapsed'}`}
    >
      <button
        type="button"
        className="accordion-trigger"
        onClick={() => onToggle(sectionId)}
        aria-expanded={isOpen}
        aria-controls={`${sectionId}-panel`}
      >
        <div className="accordion-copy">
          <p className="eyebrow">{eyebrow}</p>
          <div className="accordion-title-row">
            <h2>{title}</h2>
            {badge ? <span className="accordion-badge">{badge}</span> : null}
          </div>
          {summary ? <p className="accordion-summary">{summary}</p> : null}
        </div>
        <div className={`accordion-icon ${isOpen ? 'is-open' : ''}`}>
          <span className="accordion-icon-line"></span>
          <span className="accordion-icon-line"></span>
        </div>
      </button>

      {isOpen ? (
        <div id={`${sectionId}-panel`} className="accordion-panel">
          {(toolbar || action) ? (
            <div className="accordion-toolbar">
              {toolbar}
              {action}
            </div>
          ) : null}
          <div className="accordion-body">{children}</div>
        </div>
      ) : null}
    </section>
  )
}

function App() {
  const [nurseCount, setNurseCount] = useState(4)
  const [patients, setPatients] = useState(() => clonePatients(samplePatients))
  const [lastBalancedAt, setLastBalancedAt] = useState(() =>
    new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    }),
  )
  const [analyticsEvents, setAnalyticsEvents] = useState(() =>
    readStoredList(analyticsStorageKey),
  )
  const [feedbackEntries, setFeedbackEntries] = useState(() =>
    readStoredList(feedbackStorageKey),
  )
  const [feedbackForm, setFeedbackForm] = useState(feedbackSeed)
  const [openSections, setOpenSections] = useState(defaultSectionState)
  const [reportStatus, setReportStatus] = useState('')

  const assignment = useMemo(
    () => assignPatientsToNurses(patients, nurseCount),
    [patients, nurseCount],
  )
  const assignmentReport = useMemo(
    () => buildAssignmentReport(assignment, lastBalancedAt),
    [assignment, lastBalancedAt],
  )

  function logEvent(type, detail) {
    const event = {
      id: createId('event'),
      type,
      detail,
      createdAt: new Date().toISOString(),
    }

    setAnalyticsEvents((currentEvents) => {
      const nextEvents = [event, ...currentEvents].slice(0, 24)
      writeStoredList(analyticsStorageKey, nextEvents)
      return nextEvents
    })
  }

  function refreshBalance(eventType, detail) {
    setLastBalancedAt(
      new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    )
    logEvent(eventType, detail)
  }

  function handleNurseCountChange(event) {
    const nextCount = Number(event.target.value)

    if (Number.isNaN(nextCount)) {
      return
    }

    const safeCount = Math.min(8, Math.max(1, nextCount))

    startTransition(() => {
      setNurseCount(safeCount)
    })

    refreshBalance('nurse_count_changed', `${safeCount} nurses on assignment`)
  }

  function handlePatientChange(patientId, field, value) {
    startTransition(() => {
      setPatients((currentPatients) =>
        currentPatients.map((patient) => {
          if (patient.id !== patientId) {
            return patient
          }

          if (field === 'birthTime') {
            return {
              ...patient,
              birthTime: value,
            }
          }

          if (field === 'deliveryType' && value === 'other') {
            return {
              ...patient,
              deliveryType: value,
              birthTime: '',
              deliveryWindow: '',
            }
          }

          if (field === 'deliveryType') {
            return {
              ...patient,
              deliveryType: value,
              birthTime: patient.birthTime || '08:00',
              deliveryWindow: patient.deliveryWindow || 'under-24',
            }
          }

          return {
            ...patient,
            [field]: value,
          }
        }),
      )
    })
  }

  function handleAddPatient() {
    const usedRooms = new Set(patients.map((patient) => patient.room))
    const nextRoom = canonicalRooms.find((room) => !usedRooms.has(room))

    if (!nextRoom) {
      logEvent('patient_add_blocked', 'All canonical rooms are already in use')
      return
    }

    const nextPatient = {
      id: createId('patient'),
      room: nextRoom,
      deliveryType: 'vaginal',
      birthTime: '08:00',
      deliveryWindow: 'under-24',
      notes: 'Needs bedside report review',
    }

    startTransition(() => {
      setPatients((currentPatients) => [...currentPatients, nextPatient])
    })

    refreshBalance('patient_added', `Room ${nextPatient.room} added to the census`)
  }

  function handleRemovePatient(patientId) {
    const patient = patients.find((entry) => entry.id === patientId)

    startTransition(() => {
      setPatients((currentPatients) =>
        currentPatients.filter((entry) => entry.id !== patientId),
      )
    })

    refreshBalance(
      'patient_removed',
      patient ? `Room ${patient.room} removed from the census` : 'Patient removed',
    )
  }

  function handleResetCensus() {
    startTransition(() => {
      setPatients(clonePatients(samplePatients))
      setNurseCount(4)
    })

    refreshBalance('census_reset', 'Restored the seeded postpartum census')
  }

  function handleRebalance() {
    refreshBalance(
      'assignment_run',
      `Balanced ${patients.length} rooms across ${nurseCount} nurses`,
    )
  }

  function handleFeedbackSubmit(event) {
    event.preventDefault()

    const trimmedMessage = feedbackForm.message.trim()
    if (!trimmedMessage) {
      return
    }

    const entry = {
      id: createId('feedback'),
      ...feedbackForm,
      message: trimmedMessage,
      createdAt: new Date().toISOString(),
    }

    setFeedbackEntries((currentEntries) => {
      const nextEntries = [entry, ...currentEntries].slice(0, 12)
      writeStoredList(feedbackStorageKey, nextEntries)
      return nextEntries
    })

    setFeedbackForm(feedbackSeed)
    logEvent(
      'feedback_submitted',
      `${entry.role} rated the prototype ${entry.rating}/5`,
    )
  }

  function toggleSection(sectionId) {
    setOpenSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }))
  }

  function setAllSections(isOpen) {
    setOpenSections({
      setup: isOpen,
      census: isOpen,
      assignments: isOpen,
      queue: isOpen,
      validation: isOpen,
    })
  }

  function handleDownloadAssignments() {
    const reportBlob = new Blob([assignmentReport], { type: 'text/plain;charset=utf-8' })
    const reportUrl = URL.createObjectURL(reportBlob)
    const link = document.createElement('a')
    const fileStamp = lastBalancedAt.replace(/[^0-9A-Za-z]/g, '-')

    link.href = reportUrl
    link.download = `charge-assignments-${fileStamp || 'report'}.txt`
    link.click()
    URL.revokeObjectURL(reportUrl)
    setReportStatus('Assignment report downloaded.')
    logEvent('assignment_report_downloaded', 'Downloaded assignment report as text')
  }

  const groupedOverview = assignment.groupedPatients.map((group) => ({
    ...group,
    label: getGroupMeta(group.id).label,
  }))

  const topMetrics = [
    {
      label: 'Rooms',
      value: patients.length,
      detail: `${assignment.fairness.totalSpread} room spread`,
    },
    {
      label: 'High acuity spread',
      value: assignment.fairness.highAcuitySpread,
      detail: 'Difference in fresh deliveries',
    },
    {
      label: 'Workload score spread',
      value: assignment.fairness.workloadSpread,
      detail: 'Weighted by acuity mix',
    },
    {
      label: 'Signals captured',
      value: analyticsEvents.length + feedbackEntries.length,
      detail: 'Analytics plus direct feedback',
    },
  ]

  return (
    <main className="app-shell">
      <section className="hero-panel surface">
        <div className="hero-copy">
          <p className="eyebrow">Rapid prototyper build</p>
          <h1>Charge</h1>
          <p className="lede">
            Sort the postpartum census by acuity, then deal each group across
            the team so every nurse gets a fairer mix of fresh and stable
            patients.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="primary-button desktop-primary-action"
              onClick={handleRebalance}
            >
              Deal assignments
            </button>
            <button type="button" className="secondary-button" onClick={handleResetCensus}>
              Reset sample census
            </button>
          </div>
          <div className="section-manager">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAllSections(true)}
            >
              Expand all sections
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAllSections(false)}
            >
              Collapse all sections
            </button>
          </div>
        </div>

        <div className="hero-summary">
          <div className="summary-badge">
            <span>Spoken version</span>
            <strong>
              We sort by how fresh and complex the patients are, then deal them
              out like cards so each nurse gets a fair mix.
            </strong>
          </div>
          <dl className="metric-grid">
            {topMetrics.map((metric) => (
              <div key={metric.label} className="metric-card">
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
                <p>{metric.detail}</p>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <button
        type="button"
        className="mobile-float-action"
        onClick={handleRebalance}
        aria-label="Deal assignments"
      >
        Deal assignments
      </button>

      <section className="content-grid">
        <div className="main-column">
          <CollapsibleSection
            sectionId="setup"
            isOpen={openSections.setup}
            onToggle={toggleSection}
            eyebrow="Inputs"
            title="Shift setup"
            badge={`${nurseCount} nurses`}
            toolbar={
              <>
                <div className="meta-chip">
                  Last balanced at <strong>{lastBalancedAt}</strong>
                </div>
              </>
            }
            summary={`Allocator deals ${patients.length} rooms across ${nurseCount} nurses by acuity order.`}
          >
            <div className="control-row">
              <label className="field field-compact">
                <span>Nurses on shift</span>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={nurseCount}
                  onChange={handleNurseCountChange}
                />
              </label>
              <div className="algorithm-note">
                <strong>Allocator rule</strong>
                <p>
                  Fresh C-sections go first, then fresh vaginal deliveries, then
                  all deliveries over 24 hours, then patients without a delivery
                  timeline. Each group is dealt round-robin.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="census"
            isOpen={openSections.census}
            onToggle={toggleSection}
            eyebrow="Editable census"
            title="Rooms waiting for assignment"
            badge={`${patients.length} rooms`}
            action={
              <button
                type="button"
                className="secondary-button"
                onClick={handleAddPatient}
              >
                Add room
              </button>
            }
            summary={`${patients.length} occupied rooms ready for balancing.`}
          >
            <div className="patient-list">
              {patients.map((patient, index) => {
                const groupMeta = getGroupMeta(patient)
                const roomOptions = canonicalRooms.filter((room) => {
                  if (room === patient.room) {
                    return true
                  }

                  return !patients.some((entry) => entry.room === room)
                })

                return (
                  <article key={patient.id} className="patient-card">
                    <div className="patient-card-top">
                      <div>
                        <p className="patient-room">{patient.room}</p>
                        <span className={`acuity-pill ${groupMeta.tone}`}>
                          {groupMeta.shortLabel}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleRemovePatient(patient.id)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <label className="field">
                        <span>Room</span>
                        <select
                          value={patient.room}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'room',
                              event.target.value,
                            )
                          }
                        >
                          {roomOptions.map((room) => (
                            <option key={room} value={room}>
                              {room}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="field">
                        <span>Census row</span>
                        <input type="text" value={`Room assignment ${index + 1}`} disabled />
                      </label>

                      <label className="field">
                        <span>Delivery type</span>
                        <select
                          value={patient.deliveryType}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'deliveryType',
                              event.target.value,
                            )
                          }
                        >
                          <option value="c-section">C-section</option>
                          <option value="vaginal">Vaginal</option>
                          <option value="other">No delivery timeline</option>
                        </select>
                      </label>

                      <label className="field">
                        <span>Birth time</span>
                        <input
                          type="time"
                          value={patient.birthTime}
                          disabled={patient.deliveryType === 'other'}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'birthTime',
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="field">
                        <span>24-hour status</span>
                        <div className="toggle-group">
                          {deliveryWindows.map((windowOption) => (
                            <button
                              key={windowOption.id}
                              type="button"
                              className={`toggle-chip ${
                                patient.deliveryWindow === windowOption.id ? 'is-active' : ''
                              }`}
                              disabled={patient.deliveryType === 'other'}
                              onClick={() =>
                                handlePatientChange(
                                  patient.id,
                                  'deliveryWindow',
                                  windowOption.id,
                                )
                              }
                            >
                              {windowOption.label}
                            </button>
                          ))}
                        </div>
                      </label>

                      <label className="field field-wide">
                        <span>Notes</span>
                        <input
                          type="text"
                          value={patient.notes}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'notes',
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>
                  </article>
                )
              })}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="assignments"
            isOpen={openSections.assignments}
            onToggle={toggleSection}
            eyebrow="Balanced output"
            title="Recommended assignments"
            badge={`${assignment.fairness.totalSpread} spread`}
            toolbar={
              <>
                <div className="meta-chip">
                  {assignment.nurses.length} nurses, {patients.length} rooms
                </div>
                <div className="toolbar-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleDownloadAssignments}
                  >
                    Download assignments
                  </button>
                </div>
              </>
            }
            summary={`Spread: ${assignment.fairness.totalSpread} rooms, ${assignment.fairness.highAcuitySpread} high-acuity difference.`}
          >
            <div className="export-card">
              <div className="export-card-top">
                <div>
                  <p className="eyebrow">Output</p>
                  <h3>Shareable assignment report</h3>
                </div>
                {reportStatus ? <p className="export-status">{reportStatus}</p> : null}
              </div>
              <label className="field">
                <span>Ready to download or share</span>
                <textarea
                  className="report-box"
                  rows="12"
                  value={assignmentReport}
                  readOnly
                />
              </label>
            </div>
            <div className="nurse-grid">
              {assignment.nurses.map((nurse) => (
                <article key={nurse.id} className="nurse-card">
                  <header className="nurse-header">
                    <div>
                      <p className="eyebrow">{nurse.id}</p>
                      <h3>{nurse.patientCount} rooms assigned</h3>
                    </div>
                    <div className="score-badge">
                      Score <strong>{nurse.workloadScore}</strong>
                    </div>
                  </header>

                  <div className="nurse-stat-row">
                    {acuityGroups.map((group) => (
                      <div key={group.id} className="mini-stat">
                        <span>{statLabelFromGroup(group.id)}</span>
                        <strong>{nurse.groupCounts[group.id]}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="assigned-patient-list">
                    {nurse.patients.map((patient) => {
                      const groupMeta = getGroupMeta(patient.groupId)

                      return (
                        <div key={patient.id} className="assigned-patient">
                          <div>
                            <p className="patient-room">{patient.room}</p>
                            <strong>{patient.notes}</strong>
                          </div>
                          <div className="assigned-meta">
                            <span className={`acuity-pill ${groupMeta.tone}`}>
                              {groupMeta.shortLabel}
                            </span>
                            <p>{formatTimeline(patient)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </article>
              ))}
            </div>
          </CollapsibleSection>
        </div>

        <aside className="side-column">
          <CollapsibleSection
            sectionId="queue"
            isOpen={openSections.queue}
            onToggle={toggleSection}
            eyebrow="Queue by acuity"
            title="Deal order"
            badge={`${groupedOverview.length} bands`}
            summary={groupedOverview
              .map((group) => `${group.patients.length} in ${group.label}`)
              .join(' · ')}
          >
            <div className="queue-list">
              {groupedOverview.map((group) => (
                <article key={group.id} className="queue-card">
                  <div className="queue-heading">
                    <div>
                      <h3>{group.label}</h3>
                      <p>{group.patients.length} rooms in this hand</p>
                    </div>
                    <span className={`acuity-pill ${getGroupMeta(group.id).tone}`}>
                      Priority {getGroupMeta(group.id).priority}
                    </span>
                  </div>

                  <div className="queue-pills">
                    {group.patients.map((patient) => (
                      <span key={patient.id} className="queue-pill">
                        Room {patient.room}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="validation"
            isOpen={openSections.validation}
            onToggle={toggleSection}
            eyebrow="Validation"
            title="Prototype learning loop"
            badge={`${analyticsEvents.length + feedbackEntries.length} signals`}
            summary={`${analyticsEvents.length} signals and ${feedbackEntries.length} feedback entries captured locally.`}
          >
            <div className="validation-panel">
              <div className="validation-copy">
                <h3>Hypothesis</h3>
                <p>
                  Sorting the census first, then dealing each acuity band across
                  the team, should feel fairer than ad hoc assignment and reduce
                  the odds that one nurse inherits all of the newest patients.
                </p>
              </div>

              <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
                <label className="field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={feedbackForm.name}
                    onChange={(event) =>
                      setFeedbackForm((currentForm) => ({
                        ...currentForm,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Role</span>
                  <select
                    value={feedbackForm.role}
                    onChange={(event) =>
                      setFeedbackForm((currentForm) => ({
                        ...currentForm,
                        role: event.target.value,
                      }))
                    }
                  >
                    <option>Charge nurse</option>
                    <option>Staff nurse</option>
                    <option>Clinical educator</option>
                    <option>Unit manager</option>
                  </select>
                </label>

                <label className="field">
                  <span>Usefulness rating</span>
                  <select
                    value={feedbackForm.rating}
                    onChange={(event) =>
                      setFeedbackForm((currentForm) => ({
                        ...currentForm,
                        rating: event.target.value,
                      }))
                    }
                  >
                    <option value="5">5 - immediately useful</option>
                    <option value="4">4 - close to workable</option>
                    <option value="3">3 - useful with changes</option>
                    <option value="2">2 - unclear</option>
                    <option value="1">1 - not useful</option>
                  </select>
                </label>

                <label className="field">
                  <span>What would you change?</span>
                  <textarea
                    rows="4"
                    value={feedbackForm.message}
                    onChange={(event) =>
                      setFeedbackForm((currentForm) => ({
                        ...currentForm,
                        message: event.target.value,
                      }))
                    }
                  />
                </label>

                <button type="submit" className="primary-button">
                  Capture feedback
                </button>
              </form>
            </div>

            <div className="insight-columns">
              <div>
                <h3>Recent signals</h3>
                <ul className="signal-list">
                  {analyticsEvents.slice(0, 5).map((event) => (
                    <li key={event.id}>
                      <strong>{event.type.replaceAll('_', ' ')}</strong>
                      <span>{event.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3>Latest feedback</h3>
                <ul className="signal-list">
                  {feedbackEntries.length === 0 ? (
                    <li>
                      <strong>No feedback yet</strong>
                      <span>Use the form to collect the first usability signal.</span>
                    </li>
                  ) : (
                    feedbackEntries.slice(0, 3).map((entry) => (
                      <li key={entry.id}>
                        <strong>
                          {entry.role} rated it {entry.rating}/5
                        </strong>
                        <span>{entry.message}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </CollapsibleSection>
        </aside>
      </section>
    </main>
  )
}

export default App
