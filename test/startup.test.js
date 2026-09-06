const store = require("../dist/store");
const { reconcileOrphanRun } = require("../dist");

afterEach(() => {
    jest.restoreAllMocks();
});

test("does nothing when there is no active run", async () => {
    jest.spyOn(store, "getActiveRunId").mockResolvedValue(null);
    const projection = jest.spyOn(store, "getRunProjection");

    await reconcileOrphanRun();

    expect(projection).not.toHaveBeenCalled();
});

test("marks a non-terminal orphaned run INVALID", async () => {
    jest.spyOn(store, "getActiveRunId")
        .mockResolvedValueOnce("run-123")
        .mockResolvedValueOnce(null);

    jest.spyOn(store, "getRunProjection").mockResolvedValue({
        runId: "run-123",
        phase: "RUN_RAW",
        records: [],
    });

    const putVerdict = jest.spyOn(store, "putVerdict").mockResolvedValue(undefined);

    const updateRunPhase = jest.spyOn(store, "updateRunPhase").mockResolvedValue(undefined);

    const clearRunActive = jest.spyOn(store, "clearRunActive").mockResolvedValue(undefined);

    jest.spyOn(console, "warn").mockImplementation(() => {});

    await reconcileOrphanRun();

    expect(putVerdict).toHaveBeenCalledWith("run-123", {
        valid: false,
        reason: "RUNTIME_ERROR",
        evidence: {
            recovery: "PROCESS_RESTART",
        },
    });

    expect(updateRunPhase).toHaveBeenCalledWith("run-123", "INVALID");
    expect(clearRunActive).toHaveBeenCalled();
});
