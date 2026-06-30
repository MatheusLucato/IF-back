const { getSupabase } = require('../db');
const { overlapsServiceTime } = require('../lib/normalizers');

const supabase = getSupabase();

// Detecta conflitos de escala: membro indisponivel na data ou ja escalado em
// outro ministerio no mesmo periodo (mesmo dia + horario de culto sobreposto).
async function checkScheduleConflicts(date, serviceTime, assignments, excludeScheduleId, churchId) {
  const conflicts = [];

  // Get existing schedules for the same date with overlapping service time
  let query = supabase
    .from('schedules')
    .select('id, service_time, assignments')
    .eq('date', date);

  if (churchId) {
    query = query.eq('church_id', churchId);
  }

  if (excludeScheduleId) {
    query = query.neq('id', excludeScheduleId);
  }

  const { data: existingSchedules, error: schedulesError } = await query;

  if (schedulesError) {
    throw new Error(schedulesError.message);
  }

  // Get unavailable members for this date
  const memberIds = [];
  assignments.forEach(assignment => {
    assignment.members.forEach(member => {
      if (member.memberId) memberIds.push(member.memberId);
    });
  });

  let unavailableDates = [];
  if (memberIds.length > 0) {
    let unavailabilityQuery = supabase
      .from('user_unavailable_dates')
      .select('user_id, date')
      .eq('date', date)
      .in('user_id', memberIds);

    if (churchId) {
      unavailabilityQuery = unavailabilityQuery.eq('church_id', churchId);
    }

    const { data: unavailabilities, error: unavailabilityError } = await unavailabilityQuery;

    if (!unavailabilityError && unavailabilities) {
      unavailableDates = unavailabilities;
    }
  }

  // Check each assignment for conflicts
  assignments.forEach(assignment => {
    assignment.members.forEach(member => {
      // Check unavailability dates
      const isUnavailable = unavailableDates.some(ud => ud.user_id === member.memberId);
      if (isUnavailable) {
        conflicts.push({
          memberId: member.memberId,
          memberName: member.memberName,
          conflictingMinistry: assignment.ministryName,
          message: `${member.memberName} marcou este dia como indisponível para escalas.`
        });
      }

      existingSchedules.forEach(existingSchedule => {
        if (overlapsServiceTime(existingSchedule.service_time, serviceTime)) {
          const existingAssignments = existingSchedule.assignments || [];
          existingAssignments.forEach(existingAssignment => {
            if (existingAssignment.members.some(existingMember => existingMember.memberId === member.memberId)) {
              conflicts.push({
                memberId: member.memberId,
                memberName: member.memberName,
                conflictingScheduleId: existingSchedule.id,
                conflictingMinistry: existingAssignment.ministryName,
                conflictingServiceTime: existingSchedule.service_time,
                message: `${member.memberName} já escalado(a) em "${existingAssignment.ministryName}" neste mesmo período`
              });
            }
          });
        }
      });
    });
  });

  return conflicts;
}

module.exports = { checkScheduleConflicts };
