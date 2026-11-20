{-# LANGUAGE OverloadedStrings #-}

module Health.Types
  ( EngineInfo (..)
  , engineInfo
  ) where

import Data.Text (Text)
import Lhm.Protocol (schemaVersion)

data EngineInfo = EngineInfo
  { engineVersion :: Text
  , engineProtocolVersion :: Text
  }
  deriving (Eq, Show)

engineInfo :: EngineInfo
engineInfo =
  EngineInfo
    { engineVersion = "0.1.0"
    , engineProtocolVersion = schemaVersion
    }
