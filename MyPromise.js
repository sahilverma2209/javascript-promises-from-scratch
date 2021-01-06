const fs = require('fs')
const path = require('path')

const states = {
    PENDING: 'pending',
    FULFILLED: 'fulfilled',
    REJECTED: 'rejected',
}

const isThenable = maybePromise => maybePromise && typeof maybePromise.then === 'function'

const promiseId = {}

const pid = () => {
    let id = Math.floor((Math.random() * (100 - 5) + 5))
    if(!promiseId[id]){
        promiseId[id] = 1
        return id
    } else return pid()
}
 
function MyPromise(computation, id) {
    // constructor(computation, id){
    console.log('create promise with id = ', id)
    this._state = states.PENDING
    this._id = id
    this._value = undefined;
    this._reason = undefined;

    this._thenQueue = [];
    this._finallyQueue = [];

    // the prmoise automatically calls the computation fn when invoked with new keyword
    if(typeof computation === 'function'){
        // onFulfilled or onRejected must not be called until the 
        // execution context stack contains only platform code.
        setTimeout(() => {
            try{
                computation( // computation can throw error, therefore try catch here?
                    this._onFullfilled.bind(this),
                    this._onRejected.bind(this)
                )
            } catch(e){
                this._onRejected(e)
            }
        })
    } else {
        // native promises throw resolver exception, so ..
        throw 'TypeError: Promise resolver undefined is not a function'
    }

    // }

    // all .then and .catch are invoked immediately without waiting for the
    // computation fn to finish executing and the q's are filled
    // the ques are later handled when the computation fn finishes and calls reject or resolve
    this.then = (fulfilledFn, catchFn) => {
        fulfilledFn ? console.log('then called', this._id) : console.log('catch called',  this._id)
        // we are in control of this promise, not the computation fn
        const controlledPromise = new MyPromise(() => {}, pid())
        this._thenQueue.push([controlledPromise, fulfilledFn, catchFn])

        // by the time .then is called parent promise might already be settled
        if(this._state === states.FULFILLED){
            console.log('probably wont happen unless promise is not async')
            this._propagateFulfilled()
        } else if(this._state === states.REJECTED){
            this._propagateRejected()
        }

        fulfilledFn 
        ? console.log('returning from promise -', this._id ,' a then promise :=', controlledPromise._id)
        : console.log('returning from catch -', this._id ,' a catch promise :=', controlledPromise._id)
        // console.log('after creating then promise = ', 'id =', this._id, 'q = ', this._thenQueue)
        // .then should return a promise such that it is chainable
        // with another .then
        return controlledPromise
    }

    this.catch = (catchFn) =>{
        return this.then(undefined, catchFn)
    }

    this.finally = (sideEffectFn) => {
        // fullfilled
        if(this._state !== states.PENDING){
            sideEffectFn()
            
            return this._state === states.FULFILLED 
            ? MyPromise.resolve(this._value)
            : MyPromise.reject(this._reason)
        } 

        // still pending 
        const controlledPromise = new MyPromise(() => {}, pid())
        this._finallyQueue.push([controlledPromise, sideEffectFn])
        console.log('returning from finally -', this._id ,' :=', controlledPromise._id)
        return controlledPromise
    }

    // private methods
    // value passed from resolve() in readFile()
    this._onFullfilled = (value) => {
        console.log('\nResolved promise = ', this._id)
        this._state = states.FULFILLED
        this._value = value
        console.log('time to propagate')
        this._propagateFulfilled();
    }

    // reject
    this._onRejected = (reason) => {
        // console.log('_onRejected called on reject')
        this._state = states.REJECTED
        this._reason = reason
        this._propagateRejected();
    }

    // these methods communicate with the promises that we have in the queues
    // the ones which are dependent on the value of the parent promise
    this._propagateFulfilled = () => {
        console.log('resolve all thens = ', this._thenQueue.length)
        for(var i = 0; i < this._thenQueue.length; i++){
            const [controlledPromise, fulfilledFn] = this._thenQueue[i]
            console.log('fullfill then - ', controlledPromise._id)
            // this fn is used to calculate the value or the rejection reason of the controlledPromise
            // it takes as args value of its parent promise
            if(typeof fulfilledFn === 'function'){ 
                // run .then callback
                var valueOrPromise
                try {
                    valueOrPromise = fulfilledFn(this._value)
                } catch(e) {
                    console.log('fulfilledFn crashed, let go to catch = ', e)
                    controlledPromise._onRejected(e)
                    // break
                }

                // if it returns a promise, it assimilates it -> waits for 
                // it to fulfill and then use its value
                // how to check is it returns a promise ?? - instanceof MyPromise ?
                // yes, but specification says just check for .then method

                if(isThenable(valueOrPromise)){
                    // settling it as mentioned above, and pass results to 
                    // the controlled promise
                    console.log('assimilate the then prmose now')
                    valueOrPromise.then(
                        value => controlledPromise._onFullfilled(value),
                        reason => controlledPromise._onRejected(reason)
                    )
                } else {
                    controlledPromise._onFullfilled(valueOrPromise)
                }
            } else {
                // if fulfilledFn is not defined
                controlledPromise._onFullfilled(this._value)
            }
        }

        this._finallyQueue.forEach(([controlledPromise, sideEffectFn]) => {
            sideEffectFn()
            controlledPromise._onFullfilled(this._value)
        })

        this._thenQueue = []
        this._finallyQueue = []
    }

    this._propagateRejected = () => {
        this._thenQueue.forEach(([controlledPromise, _, catchFn]) => {
            if(typeof catchFn === 'function'){ 
                const valueOrPromise = catchFn(this._reason)

                if(isThenable(valueOrPromise)) {
                    valueOrPromise.then(
                        value => controlledPromise._onFullfilled(value),
                        reason => controlledPromise._onRejected(reason)
                    )
                } else {
                    controlledPromise._onFullfilled(valueOrPromise)
                }
            } else {
                return controlledPromise._onRejected(this._reason)
            }
        })

        this._finallyQueue.forEach(([controlledPromise, sideEffectFn]) => {
            sideEffectFn()
            controlledPromise._onRejected(this._value)
        })

        this._thenQueue = []
        this._finallyQueue = []

    }
}

// example - so, promise is used to carry out async stuff
// suppose we want to read a file (async action), we create a function 
const readFile = (filename, encoding) => new MyPromise((resolve, reject) => {
    console.log('running parent promise code')

    /*
    there will always be a callback fn within the resolver passed to the promise??
    if yes, then promise is genuinely an abstraction
    */ 
    fs.readFile(filename, encoding, (err, value) => {
        if(err) return reject(err)
        console.log('read file done')
        resolve(value)
    })
}, '001')

const delay = (time, value) => new MyPromise(resolve => {
    setTimeout(() => {
        resolve(value)
    }, time)
}, '002')


readFile(path.join(__dirname, 'index.js'), 'utf8') // 001
.then(text => { // 79
    console.log('first then running..')
    console.log('characters : ', text.length)
    return delay(2000, text.replace(/[aeiou]/g, ''))
})
.then(newText => { // 81
    console.log('2nd then running..')
    throw 'oopsies'
    console.log(newText.slice(0, 500))
    return newText
})
.then(newText => { // 81
    console.log('3rd then running..')
    // throw 'oopsies'
    console.log(newText.slice(0, 500))
})
.catch(err => { // 21
    console.error('an error occured= ', err)
    console.error(err)
})
.finally(() => console.log('All done')) // 55

// const p2 = new Promise()
// console.log('p2 = ', p2)