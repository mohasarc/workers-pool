import {Pool} from '../src/Pool';

test('Instantiating pool object', ()=>{
    let testPool = new Pool({threadCount: 5});
    expect(testPool).toBeInstanceOf(Pool);
    testPool.terminate(true);
});