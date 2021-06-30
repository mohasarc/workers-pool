# workers-pool
Creating truly asynchronus functions has never been easier!   

The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use the generated async function as 
asynchronous Promise-based functions.

**Important note 1:** This is not yet fully tested, so be careful while using it!  
**Important note 2:** Currently there is supports for only node environment!

## Installing the package
```js
npm i workers-pool
```

## Usage
### Method 1: Creating an asynchronous function

`functions.js`
```js
const Pool = require('workers-pool');
const {isMainThread} = require('worker_threads');

// Some function to be made asynchronous
function add (a, b) {
    return a + b;
}

function sub (a, b) {
    return a - b;
}

// Step 1: export the functions
module.exports.add = add;
module.exports.sub = sub;

if (isMainThread){
    // Step 2: create a pool (can create a separate pool for separate functions)
    const myPool = new Pool();

    // Step 3: generate the async version of the functions
    let addAsync = myPool.getAsyncFunc({func: add});
    let subAsync = myPool.getAsyncFunc({func: sub});

    // Step 4: export the new async functions
    module.exports.addAsync = addAsync;
    module.exports.subAsync = subAsync;
    module.exports.myPool = myPool;
}
```

`index.js`
```js
const {addAsync, subAsync, myPool} = require('./functions.js')
    
async function test() {
    try {
        let result = await addAsync(2, 5);
        console.log(result); // output: 7
    } catch (error) {
        console.log(error);
    }

    try {
        let result = await subAsync(100, 10);
        console.log(result) // output: 90
    } catch (error) {
        console.log(error);
    }
}

test().then(() => {
    myPool.terminate();
});
```
### Method 2: Executing a function on the fly
Another way to run functions on the fly is also available: 

```js
const Pool = require('workers-pool');
const {isMainThread} = require('worker_threads');
const myPool = new Pool();

function add (a, b) {
    return a + b;
}

function sub (a, b) {
    return a - b;
}

module.exports.add = add;
module.exports.sub = sub;

if (isMainThread){
    myPool.enqueueTask({
        func: add, 
        params: [2, 5], 
        resolveCallback: (result) => {
            console.log(result) // output: 7
        },
        rejectCallback: (error) => {
            // Handle error
            console.log(error);
        }
    });

    myPool.enqueueTask({
        func: sub,
        params: [100, 10],
        resolveCallback: (result) => {
            console.log(result) // output: 7
        },
        rejectCallback: (error) => {
            console.log(error);
        }
    });
}
```
Note `isMainThread` is essential to defferentiate whether a file is being run in the main 
thread or a worker thread, so it can be used to prevent certain parts of the code, especially 
pool and async functions creation, from being recursively run as shown in the example.

### Status
You can also get the status of the pools:
```js
const Pool = require('workers-pool');

Pool.status();     // brief info about the pools
Pool.status(true); // Verbose info about the pools
```