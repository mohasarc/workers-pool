# workers-pool


The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use them as if they were asynchronous functions:

## Installing the package
```js
npm i workers-pool
```

## Usage

```js
const Pool = require('workers-pool');
const pool = new Pool(5);

// The function to be used in the task (should be exported)
module.exports.add = function (a, b) {
    return a + b;
}

// Creating a TaskHandler object fot the add function by passing
// the absolute path to its file and its name
var addAsync = pool.getTaskHandler(__filename, 'add');

// Calling the function (this will be enqueued in the pools tasks
// queue waiting to be run by any idle worker thread in the pool)
addAsync.run([2, 5], function (result) {
    console.log(result) // 7
});
```

Another way to run functions on the fly is also available: 

```js
const Pool = require('workers-pool');
const pool = new Pool(5);

// The function to be used in the task (should be exported)
module.exports.add = function (a, b) {
    return a + b;
}

// enqueuing the function in the pools tasks queue waiting to 
// be run by any idle worker thread in the pool
pool.enqueueTask(__filename, 'add', [2, 5], function (){
    console.log(result) // 7
})
```