const Pool = require('../src/Pool');

test('Instantiating pool object', ()=>{
    let testPool = new Pool();
    expect(testPool).toBeTruthy();
    testPool.terminate(true);
});