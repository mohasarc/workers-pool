import { Task } from '../src/Task';

test('Task constructor', () => {
    let resolveCallback = () => 'hello';
    let rejectCallback = () => 'bye';
    let testTask = new Task('TR', [1, 'a', {A: 1, B: '1'}, true], resolveCallback, rejectCallback, 'FCN', 'D:\\a\\b\\c');
    let testTask2 = new Task('TR', [], () => {}, () => {}, 'FCN', 'D:\\a\\b\\c');

    expect(testTask).toBeInstanceOf(Task);
    expect(testTask.taskRunnerName).toBe('TR');
    expect(testTask.params).toEqual([1, 'a', {A: 1, B: '1'}, true]);
    expect(JSON.stringify(testTask.resolveCallback)).toBe(JSON.stringify(resolveCallback));
    expect(JSON.stringify(testTask.rejectCallback)).toBe(JSON.stringify(rejectCallback));
    expect(testTask.functionName).toBe('FCN');
    expect(testTask.filePath).toBe('D:\\a\\b\\c');
    expect(testTask.key).toBe(0);
    expect(testTask2.key).toBe(1);
});