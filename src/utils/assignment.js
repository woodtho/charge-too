import { canonicalRooms } from '../data/canonicalRooms'

export const acuityGroups = [
  {
    id: 'c-section-under-24',
    label: 'New C-sections under 24 hours',
    shortLabel: 'fresh C-section',
    priority: 1,
    tone: 'tone-critical',
    weight: 4,
  },
  {
    id: 'vaginal-under-24',
    label: 'New vaginal deliveries under 24 hours',
    shortLabel: 'fresh vaginal',
    priority: 2,
    tone: 'tone-alert',
    weight: 3,
  },
  {
    id: 'post-24',
    label: 'All deliveries over 24 hours',
    shortLabel: 'over 24h',
    priority: 3,
    tone: 'tone-steady',
    weight: 2,
  },
  {
    id: 'no-timeline',
    label: 'Patients without a delivery timeline',
    shortLabel: 'no timeline',
    priority: 4,
    tone: 'tone-flex',
    weight: 1,
  },
]

export const deliveryWindows = [
  {
    id: 'under-24',
    label: 'Under 24 hours',
  },
  {
    id: 'over-24',
    label: 'Over 24 hours',
  },
]

export function getGroupId(patient) {
  if (patient.deliveryType === 'c-section' && patient.deliveryWindow === 'under-24') {
    return 'c-section-under-24'
  }

  if (patient.deliveryType === 'vaginal' && patient.deliveryWindow === 'under-24') {
    return 'vaginal-under-24'
  }

  if (patient.deliveryType === 'c-section' || patient.deliveryType === 'vaginal') {
    return 'post-24'
  }

  return 'no-timeline'
}

export function getGroupMeta(patientOrGroupId) {
  const groupId =
    typeof patientOrGroupId === 'string'
      ? patientOrGroupId
      : getGroupId(patientOrGroupId)

  return acuityGroups.find((group) => group.id === groupId) ?? acuityGroups[3]
}

function sortWithinGroup(leftPatient, rightPatient) {
  if (leftPatient.birthTime && rightPatient.birthTime && leftPatient.birthTime !== rightPatient.birthTime) {
    return leftPatient.birthTime.localeCompare(rightPatient.birthTime)
  }

  const leftRoomIndex = canonicalRooms.indexOf(leftPatient.room)
  const rightRoomIndex = canonicalRooms.indexOf(rightPatient.room)

  if (leftRoomIndex !== -1 && rightRoomIndex !== -1 && leftRoomIndex !== rightRoomIndex) {
    return leftRoomIndex - rightRoomIndex
  }

  return leftPatient.room.localeCompare(rightPatient.room)
}

function createEmptyNurse(index) {
  return {
    id: `Nurse ${index + 1}`,
    patients: [],
    patientCount: 0,
    workloadScore: 0,
    groupCounts: acuityGroups.reduce((counts, group) => {
      counts[group.id] = 0
      return counts
    }, {}),
  }
}

export function assignPatientsToNurses(patients, nurseCount) {
  const safeNurseCount = Math.max(1, nurseCount)
  const nurses = Array.from({ length: safeNurseCount }, (_, index) =>
    createEmptyNurse(index),
  )

  const groupedPatients = acuityGroups.map((group) => ({
    ...group,
    patients: patients
      .filter((patient) => getGroupId(patient) === group.id)
      .sort(sortWithinGroup),
  }))

  let dealerIndex = 0

  groupedPatients.forEach((group) => {
    group.patients.forEach((patient) => {
      const nurse = nurses[dealerIndex % safeNurseCount]
      const groupMeta = getGroupMeta(group.id)

      nurse.patients.push({
        ...patient,
        groupId: group.id,
      })
      nurse.patientCount += 1
      nurse.groupCounts[group.id] += 1
      nurse.workloadScore += groupMeta.weight
      dealerIndex += 1
    })
  })

  const totals = nurses.map((nurse) => nurse.patientCount)
  const workloadScores = nurses.map((nurse) => nurse.workloadScore)
  const highAcuityCounts = nurses.map(
    (nurse) =>
      nurse.groupCounts['c-section-under-24'] + nurse.groupCounts['vaginal-under-24'],
  )

  return {
    nurses,
    groupedPatients,
    fairness: {
      totalSpread: Math.max(...totals) - Math.min(...totals),
      workloadSpread: Math.max(...workloadScores) - Math.min(...workloadScores),
      highAcuitySpread:
        Math.max(...highAcuityCounts) - Math.min(...highAcuityCounts),
    },
  }
}

export function formatTimeline(patient) {
  if (patient.deliveryType === 'other') {
    return 'No delivery clock'
  }

  const windowLabel =
    patient.deliveryWindow === 'under-24' ? 'Under 24 hours' : 'Over 24 hours'

  if (!patient.birthTime) {
    return windowLabel
  }

  return `Birth ${patient.birthTime} | ${windowLabel}`
}
