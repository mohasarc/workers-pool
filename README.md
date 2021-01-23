# workers-pool
Creating truly asynchronus functions has never been easier!   

The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use them as if they were asynchronous Promise-based functions.

**Important note 1:** This is not yet stable, you may not use it for production!  
**Important note 2:** Currently there is supports for only node environment!

## Installing the package
```js
npm i workers-pool
```

## Usage
### Method 1: Creating an asynchronous function

```js
const Pool = require('workers-pool');
const {isMainThread} = require('worker_threads');
const pool = new Pool();

function add (a, b) {
    return a + b;
}
module.exports.add = add;

addAsync = pool.getAsyncFunc({func: add});

if (isMainThread){
    addAsync(2, 5)
    .then((result)=>{
        console.log(result) // output: 7
    }).catch(err => {
        console.log(error);
    });
}
```

### Method 2: Executing a function on the fly
Another way to run functions on the fly is also available: 

```js
const Pool = require('workers-pool');
const {isMainThread} = require('worker_threads');
const pool = new Pool();

function add (a, b) {
    return a + b;
}

module.exports.add = add;

if (isMainThread){
    pool.enqueueTask({
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
}
```

### Getting status
You can also get the status of the pools:
```js
const Pool = require('workers-pool');

Pool.status();     // brief info about the pools
Pool.status(true); // Verbose info about the pools
```