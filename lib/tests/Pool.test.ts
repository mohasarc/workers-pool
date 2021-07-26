import {Pool} from '../src/Pool';

test('Instantiating pool object', ()=>{
    let testPool = new Pool({threadCount: 5});
    expect(testPool).toBeTruthy();
    testPool.terminate(true);
});