function taskControlAction(row) {
  if (Number(row?.cancel_requested) === 1 || row?.status === 'canceled') return 'cancel';
  if (row?.status === 'paused' || Number(row?.pause_requested) === 1) return 'pause';
  return 'run';
}

module.exports = { taskControlAction };
