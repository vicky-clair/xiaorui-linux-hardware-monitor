module Health.StateMachine
  ( AlertState (..)
  , AlertTransition (..)
  ) where

data AlertState
  = AlertOk
  | AlertPending
  | AlertFiring
  | AlertResolved
  deriving (Eq, Show)

data AlertTransition
  = TransitionNoop
  | TransitionTrigger
  | TransitionEscalate
  | TransitionResolve
  deriving (Eq, Show)
