import { startTransition, useMemo, useState } from 'react'
import './App.css'
import { samplePatients } from './data/samplePatients'
import {
  acuityGroups,
  assignPatientsToNurses,
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

  const assignment = useMemo(
    () => assignPatientsToNurses(patients, nurseCount),
    [patients, nurseCount],
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

          if (field === 'postpartumHours') {
            return {
              ...patient,
              postpartumHours:
                value === '' ? '' : Math.min(240, Math.max(0, Number(value))),
            }
          }

          if (field === 'deliveryType' && value === 'other') {
            return {
              ...patient,
              deliveryType: value,
              postpartumHours: '',
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
    const nextIndex = patients.length + 1
    const nextPatient = {
      id: createId('patient'),
      name: `New patient ${nextIndex}`,
      room: `TBD-${nextIndex}`,
      deliveryType: 'vaginal',
      postpartumHours: 8,
      notes: 'Needs bedside report review',
    }

    startTransition(() => {
      setPatients((currentPatients) => [...currentPatients, nextPatient])
    })

    refreshBalance('patient_added', `${nextPatient.name} added to the census`)
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
      patient ? `${patient.name} removed from the census` : 'Patient removed',
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
      `Balanced ${patients.length} patients across ${nurseCount} nurses`,
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

  const groupedOverview = assignment.groupedPatients.map((group) => ({
    ...group,
    label: getGroupMeta(group.id).label,
  }))

  const topMetrics = [
    {
      label: 'Patients',
      value: patients.length,
      detail: `${assignment.fairness.totalSpread} patient spread`,
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
            <button type="button" className="primary-button" onClick={handleRebalance}>
              Deal assignments
            </button>
            <button type="button" className="secondary-button" onClick={handleResetCensus}>
              Reset sample census
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

      <section className="content-grid">
        <div className="main-column">
          <section className="surface section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Inputs</p>
                <h2>Shift setup</h2>
              </div>
              <div className="meta-chip">
                Last balanced at <strong>{lastBalancedAt}</strong>
              </div>
            </div>

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
          </section>

          <section className="surface section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Editable census</p>
                <h2>Patients waiting for assignment</h2>
              </div>
              <button type="button" className="secondary-button" onClick={handleAddPatient}>
                Add patient
              </button>
            </div>

            <div className="patient-list">
              {patients.map((patient) => {
                const groupMeta = getGroupMeta(patient)

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
                        <span>Patient</span>
                        <input
                          type="text"
                          value={patient.name}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'name',
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Room</span>
                        <input
                          type="text"
                          value={patient.room}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'room',
                              event.target.value,
                            )
                          }
                        />
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
                        <span>Hours since delivery</span>
                        <input
                          type="number"
                          min="0"
                          max="240"
                          value={patient.postpartumHours}
                          disabled={patient.deliveryType === 'other'}
                          onChange={(event) =>
                            handlePatientChange(
                              patient.id,
                              'postpartumHours',
                              event.target.value,
                            )
                          }
                        />
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
          </section>

          <section className="surface section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Balanced output</p>
                <h2>Recommended assignments</h2>
              </div>
              <div className="meta-chip">
                {assignment.nurses.length} nurses, {patients.length} patients
              </div>
            </div>

            <div className="nurse-grid">
              {assignment.nurses.map((nurse) => (
                <article key={nurse.id} className="nurse-card">
                  <header className="nurse-header">
                    <div>
                      <p className="eyebrow">{nurse.id}</p>
                      <h3>{nurse.patientCount} patients assigned</h3>
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
                            <strong>{patient.name}</strong>
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
          </section>
        </div>

        <aside className="side-column">
          <section className="surface section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Queue by acuity</p>
                <h2>Deal order</h2>
              </div>
            </div>

            <div className="queue-list">
              {groupedOverview.map((group) => (
                <article key={group.id} className="queue-card">
                  <div className="queue-heading">
                    <div>
                      <h3>{group.label}</h3>
                      <p>{group.patients.length} patients in this hand</p>
                    </div>
                    <span className={`acuity-pill ${getGroupMeta(group.id).tone}`}>
                      Priority {getGroupMeta(group.id).priority}
                    </span>
                  </div>

                  <div className="queue-pills">
                    {group.patients.map((patient) => (
                      <span key={patient.id} className="queue-pill">
                        {patient.room} {patient.name}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="surface section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Validation</p>
                <h2>Prototype learning loop</h2>
              </div>
            </div>

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
          </section>
        </aside>
      </section>
    </main>
  )
}

export default App
