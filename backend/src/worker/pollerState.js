const state = {
    isLeader: false,
    lastPollTime: null,
};

module.exports = {
    setLeader: (isLeader) => {
        state.isLeader = isLeader;
    },
    setLastPollTime: (time) => {
        state.lastPollTime = time;
    },
    getState: () => ({ ...state })
};
