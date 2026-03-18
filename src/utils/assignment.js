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

export function getGroupId(patient) {
  const hours = Number(patient.postpartumHours)
  const hasTimeline = Number.isFinite(hours)

  if (patient.deliveryType === 'c-section' && hasTimeline && hours < 24) {
    return 'c-section-under-24'
  }

  if (patient.deliveryType === 'vaginal' && hasTimeline && hours < 24) {
    return 'vaginal-under-24'
  }

  if (
    (patient.deliveryType === 'c-section' || patient.deliveryType === 'vaginal') &&
    hasTimeline
  ) {
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
  const leftHours =
    leftPatient.postpartumHours === ''
      ? Number.POSITIVE_INFINITY
      : Number(leftPatient.postpartumHours)
  const rightHours =
    rightPatient.postpartumHours === ''
      ? Number.POSITIVE_INFINITY
      : Number(rightPatient.postpartumHours)

  if (leftHours !== rightHours) {
    return leftHours - rightHours
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
  const hours = Number(patient.postpartumHours)

  if (!Number.isFinite(hours)) {
    return 'No delivery clock'
  }

  return `${hours} hours from delivery`
}
